import { Typography } from "antd";
import type { ComponentProps, JSX } from "react";

type AntTextProps = ComponentProps<typeof Typography.Text>;

export interface UiTextProps extends Omit<AntTextProps, "component"> {
  as?: keyof JSX.IntrinsicElements;
}

export function UiText({ as = "span", ...props }: UiTextProps) {
  return <Typography.Text component={as} {...props} />;
}
