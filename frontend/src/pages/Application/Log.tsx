import {
  Box,
  Checkbox,
  Chip,
  createStyles,
  FormControlLabel,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Theme,
  withStyles,
} from "@material-ui/core";
import { WithStyles } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";
import MoreVertIcon from "@material-ui/icons/MoreVert";
import { Autocomplete, AutocompleteProps, UseAutocompleteProps } from "@material-ui/lab";
import { k8sWsPrefix } from "api/realApi";
import { push, replace } from "connected-react-router";
import debug from "debug";
import Immutable from "immutable";
import { ApplicationSidebar } from "pages/Application/ApplicationSidebar";
import queryString from "qs";
import React from "react";
import ReconnectingWebSocket from "reconnecting-websocket";
import { PodStatus } from "types/application";
import { ImmutableMap } from "typings";
import { formatTimestamp, formatDate } from "utils/date";
import { KSelect } from "widgets/KSelect";
import { Body2 } from "widgets/Label";
import { Loading } from "widgets/Loading";
import { Namespaces } from "widgets/Namespaces";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { BasePage } from "../BasePage";
import { ApplicationItemDataWrapper, WithApplicationItemDataProps } from "./ItemDataWrapper";
import { Xterm, XtermRaw } from "./Xterm";

const logger = debug("ws");
const detailedLogger = debug("ws:details");

// generated by https://www.kammerl.de/ascii/AsciiSignature.php
const logDocs =
  " _                   _______          _   _____           _                   _   _                 \n" +
  "| |                 |__   __|        | | |_   _|         | |                 | | (_)                \n" +
  "| |     ___   __ _     | | ___   ___ | |   | |  _ __  ___| |_ _ __ _   _  ___| |_ _  ___  _ __  ___ \n" +
  "| |    / _ \\ / _` |    | |/ _ \\ / _ \\| |   | | | '_ \\/ __| __| '__| | | |/ __| __| |/ _ \\| '_ \\/ __|\n" +
  "| |___| (_) | (_| |    | | (_) | (_) | |  _| |_| | | \\__ \\ |_| |  | |_| | (__| |_| | (_) | | | \\__ \\\n" +
  "|______\\___/ \\__, |    |_|\\___/ \\___/|_| |_____|_| |_|___/\\__|_|   \\__,_|\\___|\\__|_|\\___/|_| |_|___/\n" +
  "              __/ |                                                                                 \n" +
  "             |___/                                                                                  \n\n\n\n" +
  `\u001b[1;32m1\u001b[0m. Select the pod you are following in the selection menu above.

\u001b[1;32m2\u001b[0m. The select supports multiple selections, you can switch the log stream by clicking on the pod's tab.

\u001b[1;32m3\u001b[0m. The url is changing with your choices, you can share this url with other colleagues who has permissions.

\u001b[1;32m4\u001b[0m. Only the latest logs of each pod are displayed. If you want query older logs with advanced tool, please try learn about kalm log dependency.`;

const shellDocs =
  " _____  _          _ _   _______          _   _____           _                   _   _                 \n" +
  "/ ____ | |        | | | |__   __|        | | |_   _|         | |                 | | (_)                \n" +
  "| (___ | |__   ___| | |    | | ___   ___ | |   | |  _ __  ___| |_ _ __ _   _  ___| |_ _  ___  _ __  ___ \n" +
  "\\___  \\| '_ \\ / _ \\ | |    | |/ _ \\ / _ \\| |   | | | '_ \\/ __| __| '__| | | |/ __| __| |/ _ \\| '_ \\/ __|\n" +
  "____)  | | | |  __/ | |    | | (_) | (_) | |  _| |_| | | \\__ \\ |_| |  | |_| | (__| |_| | (_) | | | \\__ \\\n" +
  "|_____/|_| |_|\\___|_|_|    |_|\\___/ \\___/|_| |_____|_| |_|___/\\__|_|   \\__,_|\\___|\\__|_|\\___/|_| |_|___/\n" +
  "\n\n\n\n" +
  `\u001b[1;32m1\u001b[0m. Select the pod you are following in the selection menu above.

\u001b[1;32m2\u001b[0m. The select supports multiple selections, you can switch the shell sessions by clicking on the pod's tab.

\u001b[1;32m3\u001b[0m. The url is changing with your choices, you can share this url with other colleagues who has permissions.`;

interface TabPanelProps {
  children?: React.ReactNode;
  index: any;
  value: any;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <Typography
      component="div"
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {children}
    </Typography>
  );
}

const autocompleteStyles = (_theme: Theme) =>
  createStyles({
    root: {
      width: "100%",
      "& .MuiFormControl-root": {
        width: "100%",
        margin: "0 0 16px",
        "& input": {
          height: 24,
        },
      },
    },
  });

const MyAutocomplete = withStyles(autocompleteStyles)(
  (props: AutocompleteProps<string> & UseAutocompleteProps<string>) => {
    return <Autocomplete {...props} />;
  },
);

interface Props extends WithApplicationItemDataProps, WithStyles<typeof styles> {}

const tailLinesOptions = [100, 200, 500, 1000, 2000];

type LogOptions = ImmutableMap<{
  tailLines: number;
  // local filter timestamps refer Lens https://github.com/lensapp/lens/blob/b7974827d2b767d52b1d57fc01a9782e15dce28c/src/renderer/components/%2Bworkloads-pods/pod-logs-dialog.tsx#L141
  timestamps: boolean;
  follow: boolean;
  previous: boolean;
}>;

interface State {
  value: [string, string];
  subscribedPods: Immutable.List<[string, string]>;
  moreEl: null | HTMLElement;
  logOptions: LogOptions;
  timestampsFrom: Immutable.Map<string, string>;
}

const styles = (theme: Theme) =>
  createStyles({
    root: {},
    more: {
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "flex-start",
    },
  });

class LogStream extends React.PureComponent<Props, State> {
  private ws: ReconnectingWebSocket;
  private wsQueueMessages: any[] = [];
  private terminals: Map<string, XtermRaw> = new Map();
  private initalizedFromQuery: boolean = false;
  private isLog: boolean; // TODO: refactor this flag
  constructor(props: Props) {
    super(props);

    this.state = {
      value: ["", ""],
      subscribedPods: Immutable.List(),
      logOptions: Immutable.Map({
        tailLines: tailLinesOptions[0],
        timestamps: true,
        follow: true,
        previous: false,
      }),
      moreEl: null,
      timestampsFrom: Immutable.Map({}),
    };

    this.isLog = window.location.pathname.includes("logs");

    this.ws = this.connectWs();
  }

  private saveTerminal = (name: string, el: XtermRaw | null) => {
    if (el) {
      this.terminals.set(name, el);
    } else {
      this.terminals.delete(name);
    }
  };

  componentWillUnmount() {
    if (this.ws) {
      this.ws.close();
    }
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    const { components, activeNamespaceName } = this.props;

    let pods: Immutable.List<string> = Immutable.List();
    components?.forEach((component) => {
      component.get("pods").forEach((pod) => {
        pods = pods.push(pod.get("name"));
      });
    });

    if (!window.location.search) {
      this.props.dispatch(push(`/applications/${activeNamespaceName}/components`));
    }

    if (prevState.subscribedPods.size !== this.state.subscribedPods.size || this.state.value !== prevState.value) {
      // save selected pods in query
      const search = {
        ...queryString.parse(window.location.search.replace("?", "")),
        pods: this.state.subscribedPods.size > 0 ? this.state.subscribedPods.toJS() : undefined,
        active: !!this.state.value[0] ? this.state.value : undefined,
      };

      this.props.dispatch(
        replace({
          search: queryString.stringify(search),
        }),
      );
    }

    if (pods && !this.initalizedFromQuery) {
      // load selected pods from query, this is useful when first loaded.
      const queries = queryString.parse(window.location.search.replace("?", "")) as {
        pods: any;
        active: [string, string] | undefined;
      };
      let validPods: [string, string][] = [];
      let validValue: [string, string] = ["", ""];

      if (queries.pods) {
        if (typeof queries.pods === "string") {
          queries.pods = queryString.parse(queries.pods);
        }
        if (typeof queries.pods === "object") {
          validPods = queries.pods.filter((x: any) => pods.includes(x[0]));
        }
      }

      if (queries.active) {
        validValue = pods.includes(queries.active[0]) ? queries.active : ["", ""];
      }

      if (this.state.value !== validValue) {
        this.setState({
          value: validValue,
        });
      }

      if (this.state.subscribedPods.size !== validPods.length) {
        this.setState({
          subscribedPods: Immutable.List(validPods),
        });
      }

      this.initalizedFromQuery = true;
    }
  }

  private getTimestamps = (logs: string) => {
    const timestamps = logs.match(/^\d+\S+/gm);
    if (timestamps && timestamps.length > 0) {
      return timestamps[0];
    }
    return "";
  };

  private removeTimestamps = (logs: string) => {
    return logs.replace(/^\d+.*?\s/gm, "");
  };

  private writeData = (xterm: Terminal, data: string) => {
    this.state.logOptions.get("timestamps") ? xterm.write(data) : xterm.write(this.removeTimestamps(data));
  };

  connectWs = () => {
    const ws = new ReconnectingWebSocket(`${k8sWsPrefix}/v1alpha1/${this.isLog ? "logs" : "exec"}`);

    ws.onopen = (evt) => {
      logger("WS Connection connected.");
      ws.send(
        JSON.stringify({
          type: "authStatus",
        }),
      );
    };

    const afterWsAuthSuccess = () => {
      const { subscribedPods } = this.state;

      if (subscribedPods.size > 0) {
        Array.from(subscribedPods).forEach(([podName, containerName]) => this.subscribe(podName, containerName));
      }

      while (this.wsQueueMessages.length > 0) {
        ws.send(this.wsQueueMessages.shift());
      }
    };

    ws.onmessage = (evt) => {
      detailedLogger("Received Message: " + evt.data);
      const data = JSON.parse(evt.data);

      if (data.type === "logStreamUpdate") {
        const timestampsFrom = this.state.timestampsFrom;
        const timestamp = this.getTimestamps(data.data);

        if (!timestampsFrom.get(data.podName)) {
          this.setState({
            timestampsFrom: timestampsFrom.set(data.podName, timestamp),
          });
        }
      }

      if (data.type === "logStreamUpdate" || data.type === "execStreamUpdate") {
        const terminal = this.terminals.get(data.podName);
        if (terminal && terminal.xterm) {
          this.writeData(terminal.xterm, data.data);
        }

        return;
      }

      if (data.type === "logStreamDisconnected") {
        const terminal = this.terminals.get(data.podName);
        if (terminal && terminal.xterm) {
          this.writeData(terminal.xterm, data.data);
          // terminal.xterm.writeln("\n\u001b[1;31mPod log stream disconnected\u001b[0m\n");
          // terminal.xterm.clear();
        }
        return;
      }

      if (data.type === "execStreamDisconnected") {
        const terminal = this.terminals.get(data.podName);
        if (terminal && terminal.xterm) {
          this.writeData(terminal.xterm, data.data);
          terminal.xterm.writeln("\n\r\u001b[1;31mTerminal disconnected\u001b[0m\n");
        }
        return;
      }

      if ((data.type === "authResult" && data.status === 0) || (data.type === "authStatus" && data.status === 0)) {
        afterWsAuthSuccess();
        return;
      }

      if (data.type === "authStatus" && data.status === -1) {
        ws.send(
          JSON.stringify({
            type: "auth",
            authToken: window.localStorage.AUTHORIZED_TOKEN_KEY,
          }),
        );
        return;
      }
    };

    ws.onclose = (evt) => {
      logger("WS Connection closed.");
    };

    return ws;
  };

  subscribe = (podName: string, containerName: string, newLogOptions?: LogOptions) => {
    logger("subscribe", podName, containerName);
    const { activeNamespaceName } = this.props;
    const logOptions = newLogOptions || this.state.logOptions;

    const terminal = this.terminals.get(podName);
    if (terminal && terminal.xterm) {
      terminal.xterm.clear();
    }

    this.sendOrQueueMessage(
      JSON.stringify({
        type: this.isLog ? "subscribePodLog" : "execStartSession",
        podName,
        container: containerName,
        tailLines: logOptions.get("tailLines"),
        timestamps: true,
        follow: logOptions.get("follow"),
        previous: logOptions.get("previous"),
        namespace: activeNamespaceName,
      }),
    );
  };

  unsubscribe = (podName: string, containerName: string) => {
    const { activeNamespaceName } = this.props;
    logger("unsubscribe", podName, containerName);
    this.sendOrQueueMessage(
      JSON.stringify({
        type: this.isLog ? "unsubscribePodLog" : "execEndSession",
        podName,
        container: containerName,
        namespace: activeNamespaceName,
      }),
    );
  };

  sendOrQueueMessage = (msg: any) => {
    if (this.ws.readyState !== 1) {
      this.wsQueueMessages.push(msg);
    } else {
      this.ws.send(msg);
    }
  };

  getAllPods = (): Immutable.List<PodStatus> => {
    const { components } = this.props;

    let pods: Immutable.List<PodStatus> = Immutable.List();
    components?.forEach((component) => {
      component.get("pods").forEach((pod) => {
        pods = pods.push(pod);
      });
    });

    return pods;
  };

  onInputChange = (_event: React.ChangeEvent<{}>, x: string[]) => {
    const { subscribedPods } = this.state;
    const { value } = this.state;
    const subscribedPodNames = subscribedPods.map((x) => x[0]);
    const currentPodNames = Immutable.List(x);
    const pods = this.getAllPods();
    let newValue = value;

    const currentPods: Immutable.List<[string, string]> = currentPodNames.map((podName) => {
      const subscribedPod = subscribedPods.find((x) => x[0] === podName);
      if (subscribedPod) {
        return subscribedPod;
      } else {
        const pod = pods.find((x) => x.get("name") === podName)!;
        const containerNames = pod
          .get("containers")
          .map((x) => x.get("name"))
          .toArray();
        return [podName, containerNames[0]];
      }
    });

    subscribedPods.forEach(([podName, containerName]) => {
      if (!currentPodNames.includes(podName)) {
        this.unsubscribe(podName, containerName);
        if (podName === value[0]) {
          newValue = ["", ""];
        }
      }
    });

    currentPodNames.forEach((podName) => {
      const pod = pods.find((x) => x.get("name") === podName)!;
      const containerNames = pod
        .get("containers")
        .map((x) => x.get("name"))
        .toArray();
      if (!subscribedPodNames.includes(podName)) {
        this.subscribe(podName, containerNames[0]);
      }
      if (!newValue[0]) {
        newValue = [podName, containerNames[0]];
      }
    });

    this.setState({ subscribedPods: currentPods, value: newValue });
  };

  onInputContainerChange = (x: any) => {
    const { subscribedPods, value } = this.state;
    let newSubscribedPods = Immutable.List();
    subscribedPods.forEach(([podName, containerName]) => {
      if (podName === value[0]) {
        newSubscribedPods = newSubscribedPods.push([podName, x]);
        this.unsubscribe(podName, containerName);
        this.subscribe(podName, x);
      } else {
        newSubscribedPods = newSubscribedPods.push([podName, containerName]);
      }
    });
    this.setState({ subscribedPods: newSubscribedPods, value: [value[0], x] });
  };

  onLogOptionsChange = (newLogOptions: LogOptions) => {
    const { subscribedPods } = this.state;
    subscribedPods.forEach(([podName, containerName]) => {
      this.unsubscribe(podName, containerName);
      this.subscribe(podName, containerName, newLogOptions);
    });
    this.setState({ logOptions: newLogOptions });
  };

  private renderInputPod() {
    const { components } = this.props;

    let podNames: Immutable.List<string> = Immutable.List([]);
    components?.forEach((component) => {
      component.get("pods").forEach((pod) => {
        podNames = podNames.push(pod.get("name"));
      });
    });

    const { value, subscribedPods } = this.state;
    const subscribedPodNames = subscribedPods.map((p) => p[0]);
    const names = podNames!.toArray().filter((x) => !subscribedPodNames.includes(x));

    return (
      <MyAutocomplete
        multiple
        id="tags-filled"
        options={names}
        onChange={this.onInputChange}
        value={Array.from(subscribedPodNames)}
        renderTags={(options: string[], getTagProps) =>
          options.map((option: string, index: number) => {
            return (
              <Chip
                variant="outlined"
                label={option}
                size="small"
                onClick={(event) => {
                  const value = subscribedPods.find((x) => x[0] === option)!;
                  this.setState({ value });
                  event.stopPropagation();
                }}
                color={option === value[0] ? "primary" : "default"}
                {...getTagProps({ index })}
              />
            );
          })
        }
        renderInput={(params) => (
          <TextField
            label={"Pods"}
            {...params}
            variant="outlined"
            size="small"
            placeholder="Select the pod you want to view logs"
          />
        )}
      />
    );
  }

  private renderInputContainer() {
    const { value } = this.state;
    const pods = this.getAllPods();
    const pod = pods.find((x) => value[0] === x.get("name"))!;
    const containerNames = pod ? pod.get("containers").map((container) => container.get("name")) : Immutable.List();

    return (
      <KSelect
        label="Container"
        value={value[1]}
        options={containerNames
          .map((x) => {
            return {
              value: x,
              text: x,
            };
          })
          .toJS()}
        onChange={this.onInputContainerChange}
      />
    );
  }

  private renderInputTailLines() {
    const { logOptions } = this.state;

    return (
      <KSelect
        label="Lines"
        value={logOptions.get("tailLines")}
        options={tailLinesOptions.map((x) => {
          return {
            value: x,
            text: `${x}`,
          };
        })}
        onChange={(x) => {
          this.onLogOptionsChange(logOptions.set("tailLines", x));
        }}
      />
    );
  }

  handleClickMore = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.setState({ moreEl: event.currentTarget });
  };

  handleCloseMore = (logOptions?: LogOptions) => {
    if (logOptions) {
      this.onLogOptionsChange(logOptions);
    }
    this.setState({ moreEl: null });
  };

  private renderFromTo() {
    const { value, timestampsFrom } = this.state;
    const podName = value[0];
    if (!podName || !timestampsFrom.get(podName)) {
      return null;
    }
    return (
      <Box width="100%" display="flex" justifyContent="flex-end">
        <Box pt="3px">
          <Box display="flex">
            <Box width="50px">
              <Body2>From</Body2>
            </Box>
            <Body2>{formatTimestamp(timestampsFrom.get(podName) as string)}</Body2>
          </Box>
          <Box display="flex">
            <Box width="50px" pl={2}>
              <Body2>To</Body2>
            </Box>
            <Body2>{formatDate(new Date())}</Body2>
          </Box>
        </Box>
      </Box>
    );
  }

  private renderMore() {
    const { classes } = this.props;
    const { moreEl, logOptions } = this.state;

    const options: {
      key: "timestamps" | "follow" | "previous";
      text: string;
    }[] = [
      {
        key: "timestamps",
        text: "Show timestamps",
      },
      {
        key: "follow",
        text: "Follow logs",
      },
      {
        key: "previous",
        text: "Show previous logs",
      },
    ];

    return (
      <div className={classes.more}>
        <IconButton aria-label="more" aria-controls="log-more-menu" aria-haspopup="true" onClick={this.handleClickMore}>
          <MoreVertIcon />
        </IconButton>
        <Menu
          id="log-more-menu"
          anchorEl={moreEl}
          keepMounted
          open={Boolean(moreEl)}
          onClose={() => this.handleCloseMore()}
        >
          {options.map((option) => {
            return (
              <MenuItem
                key={option.key}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  this.handleCloseMore(logOptions.set(option.key, !logOptions.get(option.key)));
                }}
              >
                <FormControlLabel
                  control={<Checkbox checked={logOptions.get(option.key)} name={option.key} />}
                  label={option.text}
                />
              </MenuItem>
            );
          })}
        </Menu>
      </div>
    );
  }

  private renderLogTerminal = (podName: string, initializedContent?: string) => {
    const { value } = this.state;
    return (
      <Xterm
        innerRef={(el) => this.saveTerminal(podName, el)}
        show={value[0] === podName}
        initializedContent={initializedContent}
        terminalOptions={{
          cursorBlink: false,
          cursorStyle: "bar",
          cursorWidth: 0,
          disableStdin: true,
          convertEol: true,
          // fontSize: 12,
          theme: { selection: "rgba(255, 255, 72, 0.5)" },
        }}
      />
    );
  };

  private renderExecTerminal = (podName: string, initializedContent?: string) => {
    const { value } = this.state;
    return (
      <Xterm
        innerRef={(el) => this.saveTerminal(podName, el)}
        show={value[0] === podName}
        initializedContent={initializedContent}
        termianlOnData={(data: any) => {
          this.sendOrQueueMessage(
            JSON.stringify({
              type: "stdin",
              podName: podName,
              namespace: this.props.activeNamespaceName,
              data: data,
            }),
          );
        }}
        termianlOnBinary={(data: any) => {
          this.sendOrQueueMessage(
            JSON.stringify({
              type: "stdin",
              podName: podName,
              namespace: this.props.activeNamespaceName,
              data: data,
            }),
          );
        }}
        terminalOnResize={(size: { cols: number; rows: number }) => {
          this.sendOrQueueMessage(
            JSON.stringify({
              type: "resize",
              podName: podName,
              namespace: this.props.activeNamespaceName,
              data: `${size.cols},${size.rows}`,
            }),
          );
        }}
        terminalOptions={{
          // convertEol: true,
          // fontSize: 12,
          theme: { selection: "rgba(255, 255, 72, 0.5)" },
        }}
      />
    );
  };

  public render() {
    const { isLoading, application } = this.props;
    const { value, subscribedPods } = this.state;

    return (
      <BasePage
        secondHeaderLeft={<Namespaces />}
        secondHeaderRight={this.isLog ? "Log" : "Shell"}
        leftDrawer={<ApplicationSidebar />}
        fullContainer={true}
      >
        <Box p={2}>
          {isLoading || !application ? (
            <Loading />
          ) : (
            <>
              {this.isLog ? (
                <Grid container spacing={2}>
                  <Grid item md={5}>
                    {this.renderInputPod()}
                  </Grid>
                  <Grid item md={2}>
                    {this.renderInputContainer()}
                  </Grid>
                  <Grid item md={2}>
                    {this.renderInputTailLines()}
                  </Grid>
                  <Grid item md={2}>
                    {this.renderFromTo()}
                  </Grid>
                  <Grid item md={1}>
                    {this.renderMore()}
                  </Grid>
                </Grid>
              ) : (
                <Grid container spacing={2}>
                  <Grid item md={8}>
                    {this.renderInputPod()}
                  </Grid>
                  <Grid item md={4}>
                    {this.renderInputContainer()}
                  </Grid>
                </Grid>
              )}

              <TabPanel value={value[0]} key={"empty"} index={""}>
                {this.isLog ? this.renderLogTerminal("", logDocs) : this.renderLogTerminal("", shellDocs)}
              </TabPanel>
              {Array.from(subscribedPods).map(([podName]) => {
                return (
                  <TabPanel value={value[0]} key={podName} index={podName}>
                    {this.isLog ? this.renderLogTerminal(podName) : this.renderExecTerminal(podName)}
                  </TabPanel>
                );
              })}
            </>
          )}
        </Box>
      </BasePage>
    );
  }
}

export const Log = withStyles(styles)(ApplicationItemDataWrapper({ autoReload: false })(LogStream));
