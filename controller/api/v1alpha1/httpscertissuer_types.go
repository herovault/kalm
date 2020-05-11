/*

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EDIT THIS FILE!  THIS IS SCAFFOLDING FOR YOU TO OWN!
// NOTE: json tags are required.  Any new fields you add must have json tags for the fields to be serialized.

// HttpsCertIssuerSpec defines the desired state of HttpsCertIssuer
type HttpsCertIssuerSpec struct {
	// INSERT ADDITIONAL SPEC FIELDS - desired state of cluster
	// Important: Run "make" to regenerate code after modifying this file

	// +optional
	CAForTest *CAForTestIssuer `json:"caForTest,omitempty"`
	// +optional
	ACMECloudFlare *ACMECloudFlareIssuer `json:"acmeCloudFlare,omitempty"`
}

type CAForTestIssuer struct{}

type ACMECloudFlareIssuer struct {
	Email  string `json:"email"`
	APIKey string `json:"apiKey"`
}

// HttpsCertIssuerStatus defines the observed state of HttpsCertIssuer
type HttpsCertIssuerStatus struct {
	// INSERT ADDITIONAL STATUS FIELD - define observed state of cluster
	// Important: Run "make" to regenerate code after modifying this file
	OK bool `json:"ok"`
}

// +kubebuilder:object:root=true
// +kubebuilder:resource:scope=Cluster
// +kubebuilder:subresource:status

// HttpsCertIssuer is the Schema for the httpscertissuers API
type HttpsCertIssuer struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   HttpsCertIssuerSpec   `json:"spec,omitempty"`
	Status HttpsCertIssuerStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:resource:scope=Cluster
// +kubebuilder:subresource:status

// HttpsCertIssuerList contains a list of HttpsCertIssuer
type HttpsCertIssuerList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []HttpsCertIssuer `json:"items"`
}

func init() {
	SchemeBuilder.Register(&HttpsCertIssuer{}, &HttpsCertIssuerList{})
}