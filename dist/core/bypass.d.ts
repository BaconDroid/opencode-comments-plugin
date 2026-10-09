export declare const BYPASS_WINDOW = 2;
export interface Bypass {
    kind: "allow" | "disable-file";
    line: number;
    reason: string;
}
export interface BypassMatchers {
    allow: RegExp;
    allowReason: RegExp;
    disableFile: RegExp;
}
export declare function bypassMatchers(prefix: string): BypassMatchers;
export declare function collectBypasses(text: string, matchers: BypassMatchers): Bypass[];
export declare function isFileDisabled(text: string, matchers: BypassMatchers): boolean;
export interface BypassCheck {
    notes: Bypass[];
    fileDisabled: boolean;
    covers(line: number): boolean;
}
export declare function applyBypass(newText: string, matchers: BypassMatchers): BypassCheck;
export declare function withinAllowWindow(text: string, line: number, matchers: BypassMatchers, window?: number): boolean;
