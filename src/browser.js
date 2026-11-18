// The script-tag build: registers <leave-a-mark> and exposes the API as window.LeaveAMark.
import * as api from "./index.js";

api.defineLeaveAMark();
globalThis.LeaveAMark = api;
