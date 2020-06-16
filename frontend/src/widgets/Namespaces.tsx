import {
  Button,
  ClickAwayListener,
  createStyles,
  Grow,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Theme,
  withStyles,
  WithStyles
} from "@material-ui/core";
import React from "react";
import { connect } from "react-redux";
import { TDispatchProp } from "types";
import { setCurrentNamespaceAction } from "actions/namespaces";
import { push } from "connected-react-router";
import { RootState } from "reducers";
import ExpandLess from "@material-ui/icons/ExpandLess";
import ExpandMore from "@material-ui/icons/ExpandMore";
import { SECOND_HEADER_HEIGHT } from "../layout/SecondHeader";
import { LEFT_SECTION_OPEN_WIDTH } from "../pages/BasePage";
import { H4 } from "./Label";

const styles = (theme: Theme) =>
  createStyles({
    root: {
      zIndex: 10
    },
    namespaceButton: {
      height: SECOND_HEADER_HEIGHT,
      width: "100%",
      justifyContent: "space-between",
      paddingLeft: "32px",
      border: "0"
    },
    menuList: {
      width: LEFT_SECTION_OPEN_WIDTH
    }
  });

const mapStateToProps = (state: RootState) => {
  const applicationsRoot = state.get("applications");
  return {
    applications: applicationsRoot.get("applications"),
    isListFirstLoading: applicationsRoot.get("isListLoading") && !applicationsRoot.get("isListFirstLoaded"),
    active: state.get("namespaces").get("active")
  };
};

interface Props extends WithStyles<typeof styles>, ReturnType<typeof mapStateToProps>, TDispatchProp {}

interface State {
  open: boolean;
}

class NamespacesRaw extends React.PureComponent<Props, State> {
  private anchorRef = React.createRef<HTMLButtonElement>();

  constructor(props: Props) {
    super(props);
    this.state = {
      open: false
    };
  }

  private handleToggle = () => {
    this.setState({
      open: !this.state.open
    });
  };

  private handleClose = () => {
    this.setState({
      open: false
    });
  };

  private handleListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      this.handleClose();
    }
  };

  componentDidMount() {
    // this.props.dispatch(loadApplicationsAction());
  }

  public render() {
    const { classes, applications, active, dispatch, isListFirstLoading } = this.props;
    const { open } = this.state;
    const hasApplication = applications.count() > 0;
    const activeNamespace = applications.find(application => application.get("name") === active);

    if (isListFirstLoading) {
      return (
        <div className={classes.root}>
          <Button className={classes.namespaceButton}>
            <H4>Loading...</H4>
          </Button>
        </div>
      );
    }
    if (!isListFirstLoading && hasApplication) {
      return (
        <div className={classes.root}>
          <Button
            ref={this.anchorRef}
            aria-controls={open ? "menu-list-grow" : undefined}
            aria-haspopup="true"
            className={classes.namespaceButton}
            onClick={this.handleToggle}>
            <H4>
              {isListFirstLoading
                ? "Loading..."
                : activeNamespace
                ? activeNamespace.get("name")
                : "Select a Application"}
            </H4>
            {open ? <ExpandLess /> : <ExpandMore />}
          </Button>

          <Popper
            open={open}
            anchorEl={this.anchorRef.current}
            role={undefined}
            placement="bottom-start"
            transition
            disablePortal>
            {({ TransitionProps, placement }) => (
              <Grow
                {...TransitionProps}
                style={{ transformOrigin: placement === "bottom" ? "center top" : "center bottom" }}>
                <Paper>
                  <ClickAwayListener onClickAway={this.handleClose}>
                    <MenuList
                      autoFocusItem={open}
                      id="menu-list-grow"
                      onKeyDown={this.handleListKeyDown}
                      classes={{ root: classes.menuList }}>
                      {applications
                        .map(application => (
                          <MenuItem
                            onClick={() => {
                              dispatch(setCurrentNamespaceAction(application.get("name")));
                              this.handleClose();
                            }}
                            key={application.get("name")}>
                            <H4>{application.get("name")}</H4>
                          </MenuItem>
                        ))
                        .toArray()}
                    </MenuList>
                  </ClickAwayListener>
                </Paper>
              </Grow>
            )}
          </Popper>
        </div>
      );
    } else {
      return (
        <div className={classes.root}>
          <Button
            className={classes.namespaceButton}
            onClick={() => {
              dispatch(push(`/applications/new`));
            }}>
            <H4>Create Your First Application</H4>
          </Button>
        </div>
      );
    }
  }
}

export const Namespaces = withStyles(styles)(connect(mapStateToProps)(NamespacesRaw));
