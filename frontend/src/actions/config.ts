import Immutable from "immutable";
import { randomName } from "../utils";
import { getKappFiles, createKappFile, updateKappFile, deleteKappFile } from "./kubernetesApi";
import { convertToCRDFile } from "../convertors/File";
import {
  ConfigNode,
  CREATE_CONFIG,
  UPDATE_CONFIG,
  DUPLICATE_CONFIG,
  DELETE_CONFIG,
  SET_CURRENT_CONFIG_ID_CHAIN,
  LOAD_CONFIGS_PENDING,
  LOAD_CONFIGS_FULFILLED,
  ConfigFile,
  initialRootConfigNode
} from "../types/config";
import { ThunkResult } from "../types";
import { setSuccessNotificationAction } from "./notification";

export const createConfigAction = (config: ConfigNode): ThunkResult<Promise<void>> => {
  return async dispatch => {
    config = config.set("id", config.get("type") === "file" ? randomName() : config.get("name"));

    if (config.get("type") === "file") {
      const configFile = configToConfigFile(config);
      await createKappFile(convertToCRDFile(configFile));
      dispatch(setSuccessNotificationAction("Create config successful."));
    } else {
      dispatch(setSuccessNotificationAction("Create folder successful."));
    }

    dispatch({
      type: CREATE_CONFIG,
      payload: { config }
    });

    const newIdChain = config.get("ancestorIds").toArray() || [];
    newIdChain.push(config.get("id"));
    dispatch(setCurrentConfigIdChainAction(newIdChain));
  };
};

export const duplicateConfigAction = (config: ConfigNode): ThunkResult<Promise<void>> => {
  return async dispatch => {
    config = Immutable.fromJS({
      id: randomName(),
      name: config.get("name") + "-duplicate",
      type: config.get("type"),
      content: config.get("content"),
      ancestorIds: config.get("ancestorIds")
    });

    console.log("config", config.toJS());
    const configFile = configToConfigFile(config);
    await createKappFile(convertToCRDFile(configFile));
    dispatch(setSuccessNotificationAction("Create config successful."));

    dispatch({
      type: DUPLICATE_CONFIG,
      payload: { config }
    });

    const newIdChain = config.get("ancestorIds").toArray() || [];
    newIdChain.push(config.get("id"));
    dispatch(setCurrentConfigIdChainAction(newIdChain));
  };
};

export const updateConfigAction = (config: ConfigNode): ThunkResult<Promise<void>> => {
  return async dispatch => {
    const configFile = configToConfigFile(config);
    await updateKappFile(convertToCRDFile(configFile));
    dispatch(setSuccessNotificationAction("Update config successful."));

    dispatch({
      type: UPDATE_CONFIG,
      payload: { config }
    });

    const newIdChain = config.get("ancestorIds")!.toArray() || [];
    newIdChain.push(config.get("id"));
    dispatch(setCurrentConfigIdChainAction(newIdChain));

    dispatch(loadConfigsAction());
  };
};

export const deleteConfigAction = (config: ConfigNode): ThunkResult<Promise<void>> => {
  return async dispatch => {
    const configFile = configToConfigFile(config);
    await deleteKappFile(convertToCRDFile(configFile));
    dispatch(setSuccessNotificationAction("Delete config successful."));

    dispatch(setCurrentConfigIdChainAction([initialRootConfigNode.get("id")]));
    dispatch({
      type: DELETE_CONFIG,
      payload: { config }
    });

    dispatch(loadConfigsAction());
  };
};

export const setCurrentConfigIdChainAction = (idChain: string[]): ThunkResult<Promise<void>> => {
  return async dispatch => {
    dispatch({
      type: SET_CURRENT_CONFIG_ID_CHAIN,
      payload: { idChain }
    });
  };
};

export const loadConfigsAction = (): ThunkResult<Promise<void>> => {
  return async dispatch => {
    dispatch({ type: LOAD_CONFIGS_PENDING });

    const configs = await getKappFiles();
    const configNode = configsToConfigNode(configs);
    dispatch({
      type: LOAD_CONFIGS_FULFILLED,
      payload: {
        configNode
      }
    });
  };
};

export const getConfigPath = (config: ConfigNode): string => {
  if (config.get("id") === initialRootConfigNode.get("id")) {
    return "/";
  }

  const ancestorIds = config.get("ancestorIds") ? config.get("ancestorIds")!.toArray() : [];

  let path = "";
  for (let i = 1; i <= ancestorIds.length - 1; i++) {
    path = path + "/" + ancestorIds[i];
  }
  path = path + "/" + config.get("name");

  return path;
};

export const configToConfigFile = (config: ConfigNode): ConfigFile => {
  const path = getConfigPath(config);

  const configFile: ConfigFile = Immutable.fromJS({
    id: config.get("id"),
    resourceVersion: config.get("resourceVersion"),
    name: config.get("name"),
    content: config.get("content"),
    path
  });

  return configFile;
};

// file list to file tree
export const configsToConfigNode = (configs: ConfigFile[]): ConfigNode => {
  let rootConfig = initialRootConfigNode;

  for (let configFile of configs) {
    const ancestorIds: string[] = [initialRootConfigNode.get("id")];
    const immutablePath: string[] = ["children"];
    const paths = configFile.get("path").split("/");
    // eg    /a/b/c/d.yml  =>  ["", "a", "b", "c", "d.yml"]
    // so for folders(a,b,c) we use index 1,2,3
    for (let i = 1; i <= paths.length - 2; i++) {
      immutablePath.push(paths[i]);
      const config: ConfigNode = Immutable.fromJS({
        id: paths[i],
        type: "folder",
        name: paths[i],
        content: "",
        children: {},
        ancestorIds
      });
      rootConfig = rootConfig.updateIn(immutablePath, (originConfig: ConfigNode) => {
        if (originConfig) {
          return originConfig;
        }
        return config;
      });
      ancestorIds.push(paths[i]);
      immutablePath.push("children");
    }
    immutablePath.push(configFile.get("id"));
    const config: ConfigNode = Immutable.fromJS({
      id: configFile.get("id"),
      resourceVersion: configFile.get("resourceVersion"),
      type: "file",
      name: configFile.get("name"),
      content: configFile.get("content"),
      children: {},
      ancestorIds
    });
    rootConfig = rootConfig.updateIn(immutablePath, () => config);
  }
  // console.log("rootConfig", rootConfig.toJS());

  return rootConfig;
};
