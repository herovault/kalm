package controllers

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/kalmhq/kalm/controller/api/v1alpha1"
	"github.com/kalmhq/kalm/controller/utils"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var tenantCtrlLog = logf.Log.WithName("tenant-controller")

type TenantReconciler struct {
	*BaseReconciler
	ctx context.Context
}

func NewTenantReconciler(mgr ctrl.Manager) *TenantReconciler {
	return &TenantReconciler{
		BaseReconciler: NewBaseReconciler(mgr, "Tenant"),
		ctx:            context.Background(),
	}
}

type MapperForNamespaces struct{}

func (m MapperForNamespaces) Map(mapObj handler.MapObject) []reconcile.Request {
	tenantName, err := v1alpha1.GetTenantNameFromObj(mapObj.Object)

	if err != nil {
		return nil
	}

	return []reconcile.Request{{NamespacedName: types.NamespacedName{
		Name: tenantName,
	}}}
}

func (r *TenantReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.Tenant{}).
		Owns(&v1alpha1.RoleBinding{}).
		Watches(&source.Kind{Type: &corev1.Namespace{}}, &handler.EnqueueRequestsFromMapFunc{
			ToRequests: MapperForNamespaces{},
		}).
		Complete(r)
}

const TenantFinalizerName = "core.kalm.dev/tenant-finalizer"

func (r *TenantReconciler) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	tenantName := req.Name

	logger := r.Log.WithValues("tenant", tenantName)
	logger.Info("reconciling tenant")

	var tenant v1alpha1.Tenant
	err := r.Get(r.ctx, client.ObjectKey{Name: tenantName}, &tenant)
	if err != nil {
		if errors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}

		return ctrl.Result{}, err
	}

	if tenant.DeletionTimestamp == nil || tenant.DeletionTimestamp.IsZero() {
		// tenant not being deleted, add custom finalizer
		if !utils.ContainsString(tenant.Finalizers, TenantFinalizerName) {
			tenant.Finalizers = append(tenant.Finalizers, TenantFinalizerName)

			if err := r.Update(r.ctx, &tenant); err != nil {
				return ctrl.Result{}, err
			}
		}
	} else {
		// tenant being deleted, clean child resources
		if utils.ContainsString(tenant.Finalizers, TenantFinalizerName) {

			// only clean sub-resource if not global tenant

			if tenantName == v1alpha1.DefaultGlobalTenantName ||
				tenantName == v1alpha1.DefaultSystemTenantName {
				logger.Info("deleting global tenant, clean sub-resource skipped cause its too dangerous")
			} else {
				if err := r.deleteExternalResources(tenant); err != nil {
					return ctrl.Result{}, err
				}
			}

			tenant.Finalizers = utils.RemoveString(tenant.Finalizers, TenantFinalizerName)
			if err := r.Update(context.Background(), &tenant); err != nil {
				return ctrl.Result{}, err
			}
		}

		return ctrl.Result{}, nil
	}

	if err := r.ReconcileOwnerRolebindings(&tenant); err != nil {
		logger.Error(err, "ReconcileOwnerRolebindings error")
	}

	if err := r.ReconcileTenantOwnerApplicationsRolebindings(&tenant); err != nil {
		logger.Error(err, "ReconcileTenantOwnerApplicationsRolebindings error")
	}

	surplusResource, noNegative := v1alpha1.GetSurplusResource(tenant)

	if noNegative {
		logger.Info("see surplusResource, will re-schedule exceedingQuota component if exist any", "surplusResource", surplusResource)

		// if enough quota, check if any component is labeled with ExceedingQuota
		components, err := r.findComponentsToSchedule(tenant.Name, surplusResource)
		if err != nil {
			return ctrl.Result{}, err
		}
		logger.Info("to remove exceedingQuota label for components", "size", len(components))

		for _, comp := range components {
			if err := r.tryReScheduleExceedingQuotaComponent(comp.DeepCopy()); err != nil {
				return ctrl.Result{}, err
			}
		}

		logger.Info("finish remove exceedingQuota label for components")
	} else {
		logger.Info("see exceeding quota, will stop components to reduce resource usage", "res", surplusResource)

		// if exceeding quota, find component to stop
		components, err := r.findComponentsToStop(tenant.Name, surplusResource)
		if err != nil {
			return ctrl.Result{}, err
		}

		for _, comp := range components {
			if err := r.tryMarkComponentAsExceedingQuota(comp.DeepCopy()); err != nil {
				logger.Info("tryMarkComponentAsExceedingQuota failed", "key", fmt.Sprintf("%s/%s", comp.Namespace, comp.Name), "err", err)
				return ctrl.Result{}, err
			}
		}
	}

	return ctrl.Result{}, nil
}

func getOwnerRoleBindingName(tenantName, ownerEmail string) string {
	ownerEmail = strings.ReplaceAll(ownerEmail, "@", "-")
	ownerEmail = strings.ReplaceAll(ownerEmail, ".", "-")
	ownerEmail = strings.ReplaceAll(ownerEmail, "_", "-")
	return fmt.Sprintf("tenant-%s-owner-%s", tenantName, strings.ToLower(ownerEmail))
}

func (r *TenantReconciler) ReconcileOwnerRolebindings(tenant *v1alpha1.Tenant) error {
	var rolebindings v1alpha1.RoleBindingList

	if err := r.Reader.List(r.ctx, &rolebindings, client.MatchingLabels{
		v1alpha1.TenantNameLabelKey: tenant.Name,
		"tenantOwner":               "true",
	}); err != nil {
		return err
	}

	ownerMap := map[string]struct{}{}
	for _, ownerEmail := range tenant.Spec.Owners {
		ownerMap[getOwnerRoleBindingName(tenant.Name, ownerEmail)] = struct{}{}
	}

	roleBindingsMap := map[string]*v1alpha1.RoleBinding{}
	for _, rolebinding := range rolebindings.Items {
		roleBindingsMap[rolebinding.Name] = &rolebinding
	}

	needCreate := map[string]*v1alpha1.RoleBinding{}
	needDelete := map[string]*v1alpha1.RoleBinding{}

	for _, ownerEmail := range tenant.Spec.Owners {
		name := getOwnerRoleBindingName(tenant.Name, ownerEmail)

		if _, ok := roleBindingsMap[name]; !ok {
			needCreate[name] = &v1alpha1.RoleBinding{
				ObjectMeta: v1.ObjectMeta{
					Name:      name,
					Namespace: v1alpha1.KalmSystemNamespace,
					Labels: map[string]string{
						v1alpha1.TenantNameLabelKey: tenant.Name,
						"tenantOwner":               "true",
					},
				},
				Spec: v1alpha1.RoleBindingSpec{
					Subject:     ownerEmail,
					SubjectType: v1alpha1.SubjectTypeUser,
					Role:        v1alpha1.TenantRoleOwner,
					Creator:     "kalm-controller",
				},
			}
		}
	}

	for i := range rolebindings.Items {
		rolebinding := rolebindings.Items[i]
		if _, ok := ownerMap[rolebinding.Name]; !ok {
			needDelete[rolebinding.Name] = &rolebinding
		}
	}

	for _, item := range needCreate {
		_ = ctrl.SetControllerReference(tenant, item, r.Scheme)

		if err := r.Client.Create(r.ctx, item); err != nil {
			r.Log.Error(err, "create tenant owner role binding error")
			return err
		}
	}

	for _, item := range needDelete {
		if err := r.Client.Delete(r.ctx, item); err != nil {
			r.Log.Error(err, "delete tenant owner role binding error")
			return err
		}
	}

	return nil
}

func (r *TenantReconciler) ReconcileTenantOwnerApplicationRolebinding(tenant *v1alpha1.Tenant, ownerEmail, applicationName string) error {
	var rolebinding v1alpha1.RoleBinding
	name := getOwnerRoleBindingName(tenant.Name, ownerEmail)

	if err := r.Reader.Get(r.ctx, types.NamespacedName{
		Namespace: applicationName,
		Name:      name,
	}, &rolebinding); err != nil {
		if !errors.IsNotFound(err) {
			return err
		}

		roleBinding := &v1alpha1.RoleBinding{
			ObjectMeta: v1.ObjectMeta{
				Namespace: applicationName,
				Name:      name,
				Labels: map[string]string{
					v1alpha1.TenantNameLabelKey: tenant.Name,
				},
			},
			Spec: v1alpha1.RoleBindingSpec{
				Subject:     ownerEmail,
				SubjectType: v1alpha1.SubjectTypeUser,
				Role:        v1alpha1.RoleOwner,
				Creator:     "kalm-controller",
			},
		}

		_ = ctrl.SetControllerReference(tenant, roleBinding, r.Scheme)

		return r.Client.Create(r.ctx, roleBinding)
	}

	return nil
}

func (r *TenantReconciler) ReconcileTenantOwnerApplicationsRolebindings(tenant *v1alpha1.Tenant) error {
	var applications corev1.NamespaceList

	if err := r.Reader.List(r.ctx, &applications, client.MatchingLabels{
		v1alpha1.TenantNameLabelKey: tenant.Name,
	}); err != nil {
		return err
	}

	for _, owner := range tenant.Spec.Owners {
		for _, application := range applications.Items {
			if err := r.ReconcileTenantOwnerApplicationRolebinding(tenant, owner, application.Name); err != nil {
				r.Log.Error(err, fmt.Sprintf("create tenant owner %s roleBinding in application %s error", owner, application.Name))
				return err
			}
		}
	}

	return nil
}

// two types of child resources: namespaced & not-namespaced
func (r *TenantReconciler) deleteExternalResources(tenant v1alpha1.Tenant) error {
	if err := r.deleteNoneSystemNamespace(tenant.Name); err != nil {
		return err
	}

	if err := r.deleteClusterResource(tenant.Name); err != nil {
		return err
	}

	return nil
}

// rm namespace will clean all namespaced resources
func (r *TenantReconciler) deleteNoneSystemNamespace(tenantName string) error {
	var nsList corev1.NamespaceList
	if err := r.List(r.ctx, &nsList, client.MatchingLabels{v1alpha1.TenantNameLabelKey: tenantName}); err != nil {
		return err
	}

	var noneSystemNS []corev1.Namespace
	for _, ns := range nsList.Items {
		if v1alpha1.IsKalmSystemNamespace(ns.Name) {
			continue
		}

		noneSystemNS = append(noneSystemNS, ns)
	}

	for _, ns := range noneSystemNS {
		if ns.DeletionTimestamp != nil {
			continue
		}

		if err := r.Delete(r.ctx, &ns); err != nil {
			return err
		}
	}

	return nil
}

// cluster scope resource:
//   - accessToken
//   - docker registry
//   - httpscert
func (r *TenantReconciler) deleteClusterResource(tenantName string) error {
	if err := r.deleteAll(tenantName, &v1alpha1.AccessToken{}); err != nil {
		return err
	}

	if err := r.deleteAll(tenantName, &v1alpha1.DockerRegistry{}); err != nil {
		return err
	}

	if err := r.deleteAll(tenantName, &v1alpha1.HttpsCert{}); err != nil {
		return err
	}

	return nil
}

func (r *TenantReconciler) deleteAll(tenantName string, obj runtime.Object) error {
	err := r.DeleteAllOf(r.ctx, obj, &client.DeleteAllOfOptions{
		ListOptions: client.ListOptions{
			LabelSelector: client.MatchingLabelsSelector{
				Selector: labels.SelectorFromSet(map[string]string{
					v1alpha1.TenantNameLabelKey: tenantName,
				}),
			},
		},
	})
	if err != nil {
		return err
	}

	return nil
}

func (r *TenantReconciler) findComponentsToSchedule(tenantName string, surplusResource v1alpha1.ResourceList) ([]v1alpha1.Component, error) {
	r.Log.Info("findComponentsToSchedule", "tenant", tenantName, "surplusRes", surplusResource)

	var compList v1alpha1.ComponentList
	err := r.List(r.ctx, &compList, client.MatchingLabels{
		v1alpha1.TenantNameLabelKey:         tenantName,
		v1alpha1.KalmLabelKeyExceedingQuota: "true",
	})
	if err != nil {
		return nil, err
	}

	// re-schedule higher priority first
	components := compList.Items
	sort.Slice(components, func(i, j int) bool {
		return components[i].Spec.Priority > components[j].Spec.Priority
	})

	r.Log.Info("potential components to schedule", "size", len(components))

	// find components that resource sum won't exceed quota
	var compToReschedule []v1alpha1.Component

	var rescheduleSum v1alpha1.ResourceList
	for _, comp := range compList.Items {
		compResToSchedule := v1alpha1.EstimateResourceConsumption(comp, true)
		rescheduleSum = v1alpha1.SumResourceList(rescheduleSum, compResToSchedule)

		if exist, _ := v1alpha1.ExistGreaterResourceInList(rescheduleSum, surplusResource); exist {
			return compToReschedule, nil
		}

		compToReschedule = append(compToReschedule, comp)
		r.Log.Info("  components to schedule", "curSize", len(compToReschedule))
	}

	r.Log.Info("actual components to schedule", "size", len(compToReschedule))

	return compToReschedule, nil
}

func (r *TenantReconciler) findComponentsToStop(tenant string, surplusResource v1alpha1.ResourceList) ([]v1alpha1.Component, error) {
	var compList v1alpha1.ComponentList
	if err := r.List(r.ctx, &compList, client.MatchingLabels{v1alpha1.TenantNameLabelKey: tenant}); err != nil {
		return nil, err
	}

	// filter
	var components []v1alpha1.Component
	for _, comp := range compList.Items {
		if comp.Labels != nil &&
			comp.Labels[v1alpha1.KalmLabelKeyExceedingQuota] == "true" {
			continue
		}

		components = append(components, comp)
	}

	// sort, stop low priority component first
	sort.Slice(components, func(i, j int) bool {
		return components[i].Spec.Priority < components[j].Spec.Priority
	})

	var componentsToBeStopped []v1alpha1.Component
	for _, comp := range components {
		componentsToBeStopped = append(componentsToBeStopped, comp)

		resListToBeFreed := v1alpha1.EstimateResourceConsumption(comp)
		r.Log.Info("before sum", "surplusResource", surplusResource, "resListToBeFreed", resListToBeFreed)
		surplusResource = v1alpha1.SumResourceList(surplusResource, resListToBeFreed)
		r.Log.Info("stop 1 component", "surplusResource", surplusResource, "comp to be stopped", comp)

		if !v1alpha1.ExistNegativeResource(surplusResource) {
			// all >= 0, tenant quota can be healthy again
			r.Log.Info("stop early of components to stop:", "size", len(componentsToBeStopped))
			return componentsToBeStopped, nil
		}
	}

	return componentsToBeStopped, nil
}

func (r *TenantReconciler) tryReScheduleExceedingQuotaComponent(comp *v1alpha1.Component) error {
	if comp.Labels == nil {
		return nil
	}

	r.EmitNormalEvent(comp, v1alpha1.ReasonReschedule, "re-schedule exceeding quota component")

	// clean exceeding quota label
	delete(comp.Labels, v1alpha1.KalmLabelKeyExceedingQuota)

	// restore replicas
	originalReplicasStr := comp.Labels[v1alpha1.KalmLabelKeyOriginalReplicas]
	originalReplicas, err := strconv.ParseInt(originalReplicasStr, 10, 32)
	if err != nil {
		originalReplicas = 0
	}

	replicas := int32(originalReplicas)
	comp.Spec.Replicas = &replicas

	// clean original replicas label
	delete(comp.Labels, v1alpha1.KalmLabelKeyOriginalReplicas)

	return r.Update(r.ctx, comp)
}

func (r *TenantReconciler) tryMarkComponentAsExceedingQuota(comp *v1alpha1.Component) error {
	if comp.Labels == nil {
		comp.Labels = make(map[string]string)
	}

	comp.Labels[v1alpha1.KalmLabelKeyExceedingQuota] = "true"

	return r.Update(r.ctx, comp)
}
