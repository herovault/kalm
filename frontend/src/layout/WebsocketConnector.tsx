import React from "react";
import { createStyles, Theme, withStyles, WithStyles } from "@material-ui/core";
import { TDispatchProp } from "types";
import { connect } from "react-redux";
import { RootState } from "reducers";
import { getWebsocketInstance } from "../actions/websocket";
import {
  CREATE_COMPONENT,
  ApplicationComponentDetails,
  UPDATE_COMPONENT,
  DELETE_COMPONENT,
  CREATE_APPLICATION,
  DELETE_APPLICATION,
  ApplicationDetails,
  ServiceStatus,
  ADD_OR_UPDATE_SERVICE,
  DELETE_SERVICE,
  ADD_OR_UPDATE_POD,
  DELETE_POD,
  PodStatus,
} from "../types/application";
import Immutable from "immutable";
import { getKappApplicationComponentList } from "../actions/kubernetesApi";

export interface ResMessage {
  namespace: string;
  component: string;
  kind: string;
  action: "Add" | "Update" | "Delete";
  data: any;
}

const styles = (theme: Theme) =>
  createStyles({
    root: {},
  });

const mapStateToProps = (state: RootState) => {
  return {};
};

interface Props extends WithStyles<typeof styles>, ReturnType<typeof mapStateToProps>, TDispatchProp {}

interface State {}

class WebsocketConnectorRaw extends React.PureComponent<Props, State> {
  // constructor(props: Props) {
  //   super(props);
  //   this.state = {};
  // }

  private connectWebsocket() {
    const { dispatch } = this.props;

    const rws = getWebsocketInstance();

    rws.addEventListener("open", () => {
      const message = {
        method: "StartWatching",
        token:
          "eyJhbGciOiJSUzI1NiIsImtpZCI6IiJ9.eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2NvdW50Iiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9uYW1lc3BhY2UiOiJkZWZhdWx0Iiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9zZWNyZXQubmFtZSI6ImthcHAtc2FtcGxlLXVzZXItdG9rZW4teno0dGoiLCJrdWJlcm5ldGVzLmlvL3NlcnZpY2VhY2NvdW50L3NlcnZpY2UtYWNjb3VudC5uYW1lIjoia2FwcC1zYW1wbGUtdXNlciIsImt1YmVybmV0ZXMuaW8vc2VydmljZWFjY291bnQvc2VydmljZS1hY2NvdW50LnVpZCI6Ijc5ZDNkNDEwLTc1OGUtNGNkMS1hOGU5LWI2OGMxYWJkYzg2YyIsInN1YiI6InN5c3RlbTpzZXJ2aWNlYWNjb3VudDpkZWZhdWx0OmthcHAtc2FtcGxlLXVzZXIifQ.aO2wsO4PcqtWBdT10Ythf0ExAqWMgqS_YsxTMF6DVzInXkJEtzVVXUiIfYwV21fPzaiAr4-R2FoTpAkuz4BTSZXTdiO89VrbebS6rNiVe73HVC7njA23PgEHWVdtOWezc6U3Hm9FhTqdVzujf2FhAG71zGUVdt-hGZu77v9KMctxcr1Y6xVaL2H79rR6V8z2xJxlCdPST1Q11uVvrjL2msts6mIrf61PNOaGwkd5qBtqTSTOFMrehL2JjZAeZxtZZKBZlZhJUPZIEU2DQNcwjVo_RPmdB1jyzBFRueE2LYiz8vpqCq8CgtDdcDHfGLIWdgS6CfjCmti5peBRTTXdHg",
      };
      rws.send(JSON.stringify(message));
    });

    rws.onmessage = async (event) => {
      const data: ResMessage = JSON.parse(event.data);

      switch (data.kind) {
        case "Component": {
          const componentDetails: ApplicationComponentDetails = Immutable.fromJS(data.data);
          if (data.action === "Add") {
            dispatch({
              type: CREATE_COMPONENT,
              payload: { applicationName: data.namespace, component: componentDetails },
            });
          } else if (data.action === "Update") {
            dispatch({
              type: UPDATE_COMPONENT,
              payload: { applicationName: data.namespace, component: componentDetails },
            });
          } else if (data.action === "Delete") {
            dispatch({
              type: DELETE_COMPONENT,
              payload: { applicationName: data.namespace, componentName: componentDetails.get("name") },
            });
          }
          break;
        }
        case "Application": {
          let application: ApplicationDetails = Immutable.fromJS(data.data);
          if (data.action === "Add") {
            if (application.get("status") === "Active") {
              const components = await getKappApplicationComponentList(application.get("name"));
              application = application.set("components", components);
              dispatch({
                type: CREATE_APPLICATION,
                payload: { application },
              });
            }
          } else if (data.action === "Update") {
            if (application.get("status") === "Terminating") {
              dispatch({
                type: DELETE_APPLICATION,
                payload: { applicationName: application.get("name") },
              });
            } else {
              const components = await getKappApplicationComponentList(application.get("name"));
              application = application.set("components", components);
              dispatch({
                type: CREATE_APPLICATION,
                payload: { application },
              });
            }
          } else if (data.action === "Delete") {
            dispatch({
              type: DELETE_APPLICATION,
              payload: { applicationName: application.get("name") },
            });
          }
          break;
        }
        case "Service": {
          const service: ServiceStatus = Immutable.fromJS(data.data);
          if (data.action === "Add" || data.action === "Update") {
            dispatch({
              type: ADD_OR_UPDATE_SERVICE,
              payload: { applicationName: data.namespace, componentName: data.component, service },
            });
          } else if (data.action === "Delete") {
            dispatch({
              type: DELETE_SERVICE,
              payload: {
                applicationName: data.namespace,
                componentName: data.component,
                serviceName: service.get("name"),
              },
            });
          }
          break;
        }
        case "Pod": {
          const pod: PodStatus = Immutable.fromJS(data.data);
          if (data.action === "Add" || data.action === "Update") {
            dispatch({
              type: ADD_OR_UPDATE_POD,
              payload: { applicationName: data.namespace, componentName: data.component, pod },
            });
          } else if (data.action === "Delete") {
            dispatch({
              type: DELETE_POD,
              payload: {
                applicationName: data.namespace,
                componentName: data.component,
                podName: pod.get("name"),
              },
            });
          }
          break;
        }
      }
    };
  }

  public componentDidMount() {
    this.connectWebsocket();
  }

  public render() {
    return null;
  }
}

export const WebsocketConnector = withStyles(styles)(connect(mapStateToProps)(WebsocketConnectorRaw));
