import { push } from "connected-react-router";
import React, { useEffect } from "react";
import { connect, useDispatch } from "react-redux";
import { RouteComponentProps, withRouter } from "react-router-dom";
import { RootState } from "reducers";
import { TDispatchProp } from "types";

const mapStateToProps = (state: RootState) => {
  const permissionMethods = state.auth.permissionMethods;
  const impersonation = state.auth.impersonation;
  const impersonationType = state.auth.impersonationType;
  const authToken = state.auth.token;
  return { auth: state.auth, authToken, impersonation, impersonationType, ...permissionMethods };
};

export interface WithUserAuthProps extends ReturnType<typeof mapStateToProps>, TDispatchProp, RouteComponentProps {}

export const withUserAuth = (WrappedComponent: React.ComponentType<any>) => {
  const HOC: React.FC<WithUserAuthProps> = (props) => {
    const canViewPage = () => {
      const { location, canEditTenant, canViewCluster, canViewTenant, canManageCluster } = props;

      if (location.pathname.includes("/certificates")) {
        return canEditTenant() || canViewCluster();
      } else if (location.pathname.includes("/ci")) {
        return canEditTenant();
      } else if (location.pathname.includes("/cluster/nodes")) {
        return canViewCluster();
      } else if (location.pathname.includes("/cluster/loadbalancer")) {
        return canViewTenant();
      } else if (location.pathname.includes("/cluster/disks")) {
        return true;
      } else if (location.pathname.includes("/cluster/pull-secrets")) {
        return canEditTenant();
      } else if (location.pathname.includes("/sso")) {
        return canViewCluster();
      } else if (location.pathname.includes("/cluster/members")) {
        return canManageCluster();
      } else if (location.pathname.includes("/version")) {
        return canManageCluster();
      }
      return true;
    };

    const dispatch = useDispatch();
    const didMount = () => {
      if (!canViewPage()) {
        dispatch(push("/"));
      }
    };
    useEffect(didMount, []);

    return <WrappedComponent {...props} />;
  };

  HOC.displayName = `withUserAuth(${getDisplayName(WrappedComponent)})`;

  return connect(mapStateToProps)(withRouter(HOC));
};

function getDisplayName(WrappedComponent: React.ComponentType<any>) {
  return WrappedComponent.displayName || WrappedComponent.name || "Component";
}
