import React from "react";
import { connect, DispatchProp } from "react-redux";
import { WrappedFieldArrayProps } from "redux-form";
import { Field, FieldArray } from "redux-form/immutable";
import { RootState } from "../../reducers";
import { getComponentVolumeType } from "../../selectors/component";
import {
  Volume,
  VolumeTypePersistentVolumeClaimExisting,
  VolumeTypePersistentVolumeClaimNew,
  VolumeTypeTemporaryDisk,
  VolumeTypeTemporaryMemory
} from "../../types/componentTemplate";
import { FieldArrayWrapper } from "../Basic/FieldArrayWrapper";
import { RenderSelectField } from "../Basic/select";
import { KRenderTextField } from "../Basic/textfield";
import { ValidatorRequired } from "../validator";

const mapStateToProps = (state: RootState) => {
  return {
    storageClasses: state.get("persistentVolumes").get("storageClasses")
  };
};

interface FieldArrayComponentHackType {
  name: any;
  component: any;
}

interface FieldArrayProps extends DispatchProp, ReturnType<typeof mapStateToProps> {}

interface Props extends WrappedFieldArrayProps<Volume>, FieldArrayComponentHackType, FieldArrayProps {}

class RenderVolumes extends React.PureComponent<Props> {
  private getStorageClassesOptions() {
    const { storageClasses } = this.props;

    const options: {
      value: string;
      text: string;
    }[] = [];

    storageClasses.forEach(sc => {
      options.push({
        value: sc.get("name"),
        text: sc.get("name")
      });
    });

    return options;
  }

  public getFieldComponents(member: string) {
    const volumeType = getComponentVolumeType(member);

    const fieldComponents = [
      <Field
        name={`${member}.type`}
        component={RenderSelectField}
        label="Type"
        validate={[ValidatorRequired]}
        placeholder="Select a volume type"
        options={[
          { value: VolumeTypePersistentVolumeClaimNew, text: "Create and mount disk" },
          { value: VolumeTypePersistentVolumeClaimExisting, text: "Mount an existing disk" },
          { value: VolumeTypeTemporaryDisk, text: "Mount a temporary Disk" },
          { value: VolumeTypeTemporaryMemory, text: "Mount a temporary memory Disk" }
        ]}></Field>,
      <Field
        component={KRenderTextField}
        name={`${member}.path`}
        label="Mount Path"
        margin
        validate={[ValidatorRequired]}
      />
    ];

    if (volumeType === VolumeTypePersistentVolumeClaimNew) {
      fieldComponents.push(
        <Field
          label="Storage Class"
          name={`${member}.storageClassName`}
          component={RenderSelectField}
          placeholder="Select the type of your disk"
          options={this.getStorageClassesOptions()}></Field>
      );
      fieldComponents.push(
        <Field
          component={KRenderTextField}
          name={`${member}.size`}
          label="Size"
          margin
          validate={[ValidatorRequired]}
        />
      );
    } else if (volumeType === VolumeTypePersistentVolumeClaimExisting) {
      fieldComponents.push(
        <Field
          label="Storage Class"
          name={`${member}.storageClassName`}
          component={RenderSelectField}
          placeholder="Select the type of your disk"
          options={this.getStorageClassesOptions()}></Field>
      );
    } else {
      fieldComponents.push(
        <Field
          component={KRenderTextField}
          name={`${member}.size`}
          label="Size"
          margin
          validate={[ValidatorRequired]}
        />
      );
    }

    return fieldComponents;
  }

  public render() {
    return (
      <FieldArrayWrapper
        getFieldComponents={(member: string) => this.getFieldComponents(member)}
        // onAdd={() => this.props.fields.push(Immutable.Map({}))}
        {...this.props}
      />
    );
  }
}

export const Volumes = connect(mapStateToProps)((props: FieldArrayProps) => {
  return <FieldArray name="volumes" component={RenderVolumes} {...props} />;
});
