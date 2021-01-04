package controllers

import (
	"context"
	"fmt"
	"strings"

	"github.com/kalmhq/kalm/controller/api/v1alpha1"
	corev1alpha1 "github.com/kalmhq/kalm/controller/api/v1alpha1"
	installv1alpha1 "github.com/kalmhq/kalm/operator/api/v1alpha1"
	"istio.io/api/security/v1beta1"
	v1beta13 "istio.io/api/type/v1beta1"
	v1beta12 "istio.io/client-go/pkg/apis/security/v1beta1"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metaV1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func getKalmDashboardVersion(configSpec installv1alpha1.KalmOperatorConfigSpec) string {
	dashboardConfig := configSpec.Dashboard
	if dashboardConfig != nil {
		if dashboardConfig.Version != nil && *dashboardConfig.Version != "" {
			return *dashboardConfig.Version
		}
	}

	if configSpec.Version != "" {
		return configSpec.Version
	}

	if configSpec.KalmVersion != "" {
		return configSpec.KalmVersion
	}

	return "latest"
}

func getKalmDashboardCommand(config *installv1alpha1.KalmOperatorConfig) string {
	var sb strings.Builder
	sb.WriteString("./kalm-api-server")

	if config.Spec.Dashboard != nil {
		for _, item := range config.Spec.Dashboard.Args {
			sb.WriteString(" ")
			sb.WriteString(item)
		}
	}

	if config.Spec.KalmType != "" {
		sb.WriteString(" ")
		sb.WriteString(fmt.Sprintf("--kalm-mode=%s", DecideKalmMode(config.Spec)))
	}

	if config.Spec.BaseAppDomain != "" {
		sb.WriteString(" ")
		sb.WriteString(fmt.Sprintf("--base-app-domain=%s", config.Spec.BaseAppDomain))
	}

	if config.Spec.BaseDNSDomain != "" {
		sb.WriteString(" ")
		sb.WriteString(fmt.Sprintf("--base-dns-domain=%s", config.Spec.BaseDNSDomain))
	}

	return sb.String()
}

func getKalmDashboardEnvs(config *installv1alpha1.KalmOperatorConfig) []corev1alpha1.EnvVar {
	var envs []corev1alpha1.EnvVar
	if config.Spec.Dashboard != nil {
		for _, nv := range config.Spec.Dashboard.Envs {
			envs = append(envs, corev1alpha1.EnvVar{
				Name:  nv.Name,
				Value: nv.Value,
				Type:  corev1alpha1.EnvVarTypeStatic,
			})
		}
	}
	return envs
}

func getKalmDashboardReplicas(config *installv1alpha1.KalmOperatorConfig) *int32 {
	if config.Spec.Dashboard != nil && config.Spec.Dashboard.Replicas != nil {
		return config.Spec.Dashboard.Replicas
	}

	n := int32(1)

	return &n
}

const dashboardName = "kalm"

func (r *KalmOperatorConfigReconciler) reconcileKalmDashboard(config *installv1alpha1.KalmOperatorConfig) error {

	if err := r.reconcileDashboardComponent(config); err != nil {
		r.Log.Info("reconcileDashboardComponent fail", "error", err)
		return err
	}

	if err := r.reconcileAuthzPolicyForDashboard(); err != nil {
		r.Log.Info("reconcileAuthzPolicyForDashboard fail", "error", err)
		return err
	}

	isSaaSMode := config.Spec.SaaSModeConfig != nil
	isBYOCMode := config.Spec.BYOCModeConfig != nil

	if isSaaSMode || isBYOCMode {
		err := r.reconcileAccessForDashboard(config)
		if err != nil {
			r.Log.Info("reconcileAccessForDashboard fail", "error", err)
			return err
		}
	}

	return nil
}

func (r *KalmOperatorConfigReconciler) reconcileDashboardComponent(config *installv1alpha1.KalmOperatorConfig) error {
	dashboardName := "kalm"
	dashboard := corev1alpha1.Component{}

	componentKey := types.NamespacedName{
		Name:      dashboardName,
		Namespace: NamespaceKalmSystem,
	}

	if config.Spec.SkipKalmDashboardInstallation {
		err := r.Get(r.Ctx, componentKey, &dashboard)
		if errors.IsNotFound(err) {
			return nil
		}

		return r.Delete(context.Background(), &dashboard)
	}

	dashboardVersion := getKalmDashboardVersion(config.Spec)
	command := getKalmDashboardCommand(config)
	envs := getKalmDashboardEnvs(config)

	expectedDashboard := corev1alpha1.Component{
		ObjectMeta: ctrl.ObjectMeta{
			Namespace: NamespaceKalmSystem,
			Name:      dashboardName,
			Labels: map[string]string{
				corev1alpha1.TenantNameLabelKey: corev1alpha1.DefaultSystemTenantName,
			},
		},
		Spec: corev1alpha1.ComponentSpec{
			Image:    fmt.Sprintf("%s:%s", KalmDashboardImgRepo, dashboardVersion),
			Command:  command,
			Env:      envs,
			Replicas: getKalmDashboardReplicas(config),
			Ports: []corev1alpha1.Port{
				{
					Protocol:      corev1alpha1.PortProtocolHTTP,
					ContainerPort: 3001,
					ServicePort:   80,
				},
			},
			LivenessProbe: &corev1.Probe{
				InitialDelaySeconds: 15,
				PeriodSeconds:       10,
				SuccessThreshold:    1,
				TimeoutSeconds:      1,
				FailureThreshold:    3,
				Handler: v1.Handler{
					HTTPGet: &v1.HTTPGetAction{
						Path:   "/ping",
						Port:   intstr.FromInt(3001),
						Scheme: v1.URISchemeHTTP,
					},
				},
			},
			ReadinessProbe: &corev1.Probe{
				InitialDelaySeconds: 15,
				PeriodSeconds:       10,
				SuccessThreshold:    1,
				TimeoutSeconds:      1,
				FailureThreshold:    3,
				Handler: v1.Handler{
					HTTPGet: &v1.HTTPGetAction{
						Path:   "/ping",
						Port:   intstr.FromInt(3001),
						Scheme: v1.URISchemeHTTP,
					},
				},
			},
		},
	}

	err := r.Get(r.Ctx, componentKey, &dashboard)
	if err != nil {
		if !errors.IsNotFound(err) {
			return err
		}

		if err := r.Client.Create(r.Ctx, &expectedDashboard); err != nil {
			return err
		}
	} else {
		dashboard.Spec = expectedDashboard.Spec

		if dashboard.Labels == nil {
			dashboard.Labels = make(map[string]string)
		}
		// inherit labels from expected
		for k, v := range expectedDashboard.Labels {
			dashboard.Labels[k] = v
		}

		r.Log.Info("updating dashboard component in kalm-system")

		if err := r.Client.Update(r.Ctx, &dashboard); err != nil {
			r.Log.Error(err, "fail updating dashboard component in kalm-system")
			return err
		}
	}

	return nil
}

// Create policy, only allow traffic from istio-ingressgateway to reach kalm api/dashboard
func (r *KalmOperatorConfigReconciler) reconcileAuthzPolicyForDashboard() error {

	expectedPolicy := &v1beta12.AuthorizationPolicy{
		ObjectMeta: metaV1.ObjectMeta{
			Namespace: NamespaceKalmSystem,
			Name:      dashboardName,
		},
		Spec: v1beta1.AuthorizationPolicy{
			Selector: &v1beta13.WorkloadSelector{
				MatchLabels: map[string]string{
					"app": dashboardName,
				},
			},
			Action: v1beta1.AuthorizationPolicy_ALLOW,
			Rules: []*v1beta1.Rule{
				{
					When: []*v1beta1.Condition{
						{
							Key: "source.namespace",
							Values: []string{
								"istio-system",
							},
						},
					},
				},
			},
		},
	}

	var fetchedPolicy v1beta12.AuthorizationPolicy
	err := r.Get(r.Ctx, types.NamespacedName{Name: expectedPolicy.Name, Namespace: expectedPolicy.Namespace}, &fetchedPolicy)
	if err != nil {
		if !errors.IsNotFound(err) {
			return err
		}

		if err := r.Client.Create(r.Ctx, expectedPolicy); err != nil {
			return err
		}
	} else {
		// dashboard.Spec = expectedDashboard.Spec
		copied := fetchedPolicy.DeepCopy()
		copied.Spec = expectedPolicy.Spec

		if err := r.Client.Patch(r.Ctx, copied, client.MergeFrom(&fetchedPolicy)); err != nil {
			return err
		}
	}

	return nil
}

//todo move these const to v1alpha1
const (
	// KalmRouteCertName         = "kalm-cert"
	KalmRouteName             = "kalm-route"
	KalmProtectedEndpointName = "kalm"
	SSO_NAME                  = "sso"
)

// - wildcard cert
// - httpRoute
// - protectedEndpoint
// - sso to kalm-SaaS
func (r *KalmOperatorConfigReconciler) reconcileAccessForDashboard(config *installv1alpha1.KalmOperatorConfig) error {

	var baseDomain string
	var oidcIssuer *installv1alpha1.OIDCIssuerConfig

	if config.Spec.SaaSModeConfig != nil {
		baseDomain = config.Spec.SaaSModeConfig.BaseDashboardDomain
		oidcIssuer = config.Spec.SaaSModeConfig.OIDCIssuer
	} else if config.Spec.BYOCModeConfig != nil {
		baseDomain = config.Spec.BYOCModeConfig.BaseDashboardDomain
		oidcIssuer = config.Spec.BYOCModeConfig.OIDCIssuer
	}

	if baseDomain == "" {
		return nil
	}

	if err := r.reconcileHttpsCertForDomain(baseDomain, true); err != nil {
		r.Log.Info("reconcileHttpsCertForDomain fail", "error", err)
		return err
	}

	if err := r.reconcileHttpRouteForDashboard(baseDomain); err != nil {
		r.Log.Info("reconcileHttpRouteForDashboard fail", "error", err)
		return err
	}

	if err := r.reconcileProtectedEndpointForDashboard(baseDomain); err != nil {
		r.Log.Info("reconcileProtectedEndpointForDashboard fail", "error", err)
		return err
	}

	if oidcIssuer != nil {
		err := r.reconcileSSOForOIDCIssuer(oidcIssuer, baseDomain)
		if err != nil {
			r.Log.Info("reconcileSSOForOIDCIssuer fail", "error", err)
			return err
		} else {
			r.Log.Info("reconcileSSOForOIDCIssuer succeed")
		}
	}

	return nil
}

func (r *KalmOperatorConfigReconciler) reconcileHttpRouteForDashboard(baseDashboardDomain string) error {
	domains := []string{
		baseDashboardDomain,
		fmt.Sprintf("*.%s", baseDashboardDomain),
	}

	expectedRoute := v1alpha1.HttpRoute{
		ObjectMeta: metav1.ObjectMeta{
			Name: KalmRouteName,
			Labels: map[string]string{
				v1alpha1.TenantNameLabelKey: v1alpha1.DefaultSystemTenantName,
			},
		},
		Spec: v1alpha1.HttpRouteSpec{
			Hosts: domains,
			Paths: []string{"/"},
			Schemes: []v1alpha1.HttpRouteScheme{
				"https", "http",
			},
			Methods: []v1alpha1.HttpRouteMethod{
				"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT",
			},
			HttpRedirectToHttps: true,
			Destinations: []v1alpha1.HttpRouteDestination{
				{
					Host:   "kalm.kalm-system.svc.cluster.local:80",
					Weight: 1,
				},
			},
		},
	}

	routeObjKey := client.ObjectKey{Name: KalmRouteName}

	route := v1alpha1.HttpRoute{}
	isNew := false

	if err := r.Get(r.Ctx, routeObjKey, &route); err != nil {
		if !errors.IsNotFound(err) {
			return err
		}

		isNew = true
		route = expectedRoute
	}

	if isNew {
		return r.Create(r.Ctx, &route)
	} else {
		route.Spec = expectedRoute.Spec
		return r.Update(r.Ctx, &route)
	}
}

func (r *KalmOperatorConfigReconciler) reconcileProtectedEndpointForDashboard(baseDashboardDomain string) error {
	expectedEndpoint := v1alpha1.ProtectedEndpoint{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: v1alpha1.KalmSystemNamespace,
			Name:      KalmProtectedEndpointName,
			Labels: map[string]string{
				v1alpha1.TenantNameLabelKey: v1alpha1.DefaultSystemTenantName,
			},
		},
		Spec: v1alpha1.ProtectedEndpointSpec{
			EndpointName:                "kalm",
			Ports:                       []uint32{3001},
			AllowToPassIfHasBearerToken: true,
			Tenants:                     []string{"*"},
		},
	}

	endpoint := v1alpha1.ProtectedEndpoint{}
	isNew := false

	objKey := client.ObjectKey{Namespace: v1alpha1.KalmSystemNamespace, Name: KalmProtectedEndpointName}

	if err := r.Get(r.Ctx, objKey, &endpoint); err != nil {
		if !errors.IsNotFound(err) {
			return err
		}

		isNew = true
		endpoint = expectedEndpoint
	}

	if isNew {
		return r.Create(r.Ctx, &endpoint)
	} else {
		endpoint.Spec = expectedEndpoint.Spec
		return r.Update(r.Ctx, &endpoint)
	}
}

func (r *KalmOperatorConfigReconciler) reconcileSSOForOIDCIssuer(oidcIssuer *installv1alpha1.OIDCIssuerConfig, authProxyDomain string) error {
	if oidcIssuer == nil {
		return fmt.Errorf("oidcIssuerConfig should not be nil")
	}

	expirySec := uint32(300)

	expectedSSO := v1alpha1.SingleSignOnConfig{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: v1alpha1.KalmSystemNamespace,
			Name:      SSO_NAME,
			Labels: map[string]string{
				v1alpha1.TenantNameLabelKey: v1alpha1.DefaultSystemTenantName,
			},
		},
		Spec: v1alpha1.SingleSignOnConfigSpec{
			Issuer:               oidcIssuer.IssuerURL,
			IssuerClientId:       oidcIssuer.ClientId,
			IssuerClientSecret:   oidcIssuer.ClientSecret,
			IDTokenExpirySeconds: &expirySec,
			Domain:               authProxyDomain,
		},
	}

	objKey := client.ObjectKey{
		Namespace: v1alpha1.KalmSystemNamespace,
		Name:      SSO_NAME,
	}

	sso := v1alpha1.SingleSignOnConfig{}
	isNew := false

	if err := r.Get(r.Ctx, objKey, &sso); err != nil {
		if !errors.IsNotFound(err) {
			return err
		}

		isNew = true
		sso = expectedSSO
	}

	if isNew {
		return r.Create(r.Ctx, &sso)
	} else {
		sso.Spec = expectedSSO.Spec
		return r.Update(r.Ctx, &sso)
	}
}
