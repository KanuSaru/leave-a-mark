import type { CSSProperties, ReactElement } from "react";
import type { GuestbookOptions } from "./index.js";

export interface LeaveAMarkProps extends GuestbookOptions {
  className?: string;
  style?: CSSProperties;
}

export declare function LeaveAMark(props: LeaveAMarkProps): ReactElement;
