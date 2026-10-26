// Type declarations for glob v7 (legacy)
// glob v13+ provides its own types, but transitive dependencies may pull in v7
declare module 'glob' {
  export interface GlobOptions {
    cwd?: string;
    root?: string;
    dot?: boolean;
    nomount?: boolean;
    mark?: boolean;
    nosort?: boolean;
    stat?: boolean;
    silent?: boolean;
    strict?: boolean;
    cache?: Record<string, any>;
    statCache?: Record<string, any>;
    symlinks?: Record<string, any>;
    sync?: boolean;
    nodir?: boolean;
    ignore?: string | string[];
    follow?: boolean;
    realpath?: boolean;
    absolute?: boolean;
  }

  export interface GlobStat {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
  }

  export type GlobCallback = (err: Error | null, matches: string[]) => void;

  export function glob(pattern: string, options: GlobOptions, callback: GlobCallback): void;
  export function glob(pattern: string, callback: GlobCallback): void;
  export function glob(pattern: string, options?: GlobOptions): Promise<string[]>;

  export function globSync(pattern: string, options?: GlobOptions): string[];

  export const glob: {
    (pattern: string, options: GlobOptions, callback: GlobCallback): void;
    (pattern: string, callback: GlobCallback): void;
    (pattern: string, options?: GlobOptions): Promise<string[]>;
    sync: (pattern: string, options?: GlobOptions) => string[];
    Glob: new (pattern: string, options?: GlobOptions) => Glob;
    GlobSync: new (pattern: string, options?: GlobOptions) => GlobSync;
  };

  export class Glob {
    constructor(pattern: string, options?: GlobOptions);
    found: string[];
    finished: boolean;
    paused: boolean;
    aborted: boolean;
    options: GlobOptions;
    emit(event: 'match', match: string): boolean;
    emit(event: 'end', matches: string[]): boolean;
    emit(event: 'error', err: Error): boolean;
    emit(event: 'abort'): boolean;
    on(event: 'match', listener: (match: string) => void): this;
    on(event: 'end', listener: (matches: string[]) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'abort', listener: () => void): this;
    pause(): void;
    resume(): void;
    abort(): void;
  }

  export class GlobSync {
    constructor(pattern: string, options?: GlobOptions);
    found: string[];
    finished: boolean;
  }
}