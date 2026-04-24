/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { RGBA, StyledText, TextAttributes } from "@opentui/core";
import type { TextChunk } from "@opentui/core";
import { onMount, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type { TextRenderable } from "@opentui/core";
import { spawn } from "node:child_process";

const ANSI_COLORS: Record<number, [number, number, number]> = {
  30: [0, 0, 0], // black
  31: [197, 49, 49], // red
  32: [30, 166, 79], // green
  33: [215, 175, 0], // yellow
  34: [0, 115, 189], // blue
  35: [136, 23, 152], // magenta
  36: [0, 152, 165], // cyan
  37: [204, 204, 204], // white
  90: [85, 85, 85], // bright black
  91: [252, 96, 97], // bright red
  92: [49, 231, 101], // bright green
  93: [253, 215, 101], // bright yellow
  94: [100, 171, 234], // bright blue
  95: [218, 112, 214], // bright magenta
  96: [105, 217, 222], // bright cyan
  97: [255, 255, 255], // bright white
};

for (let i = 0; i < 8; i++) {
  ANSI_COLORS[40 + i] = ANSI_COLORS[30 + i]!;
  ANSI_COLORS[100 + i] = ANSI_COLORS[90 + i]!;
}

function ansi256ToRgb(index: number): [number, number, number] {
  if (index < 16) {
    const c = ANSI_COLORS[index];
    if (c) return c;
  }
  if (index < 232) {
    const cubeIndex = index - 16;
    const r = Math.floor(cubeIndex / 36) * 51;
    const g = Math.floor((cubeIndex % 36) / 6) * 51;
    const b = (cubeIndex % 6) * 51;
    return [r, g, b];
  }
  const gray = (index - 232) * 10 + 8;
  return [gray, gray, gray];
}

function parseAnsi(input: string, defaultColor?: RGBA): StyledText {
  const chunks: TextChunk[] = [];
  let currentText = "";
  let currentFg: RGBA | undefined;
  let currentBg: RGBA | undefined;
  let currentAttrs = TextAttributes.NONE;

  function pushChunk() {
    if (currentText.length > 0) {
      chunks.push({
        __isChunk: true,
        text: currentText,
        fg: currentFg ?? defaultColor,
        bg: currentBg,
        attributes: currentAttrs,
      });
      currentText = "";
    }
  }

  let i = 0;
  while (i < input.length) {
    if (input[i] === "\x1b" && input[i + 1] === "[") {
      pushChunk();
      i += 2;
      let codeStr = "";
      while (i < input.length && input[i] !== "m") {
        codeStr += input[i];
        i++;
      }
      i++; // skip 'm'

      const codes = codeStr.split(";").map((s) => parseInt(s, 10) || 0);
      let j = 0;
      while (j < codes.length) {
        const code = codes[j];
        if (code === undefined) {
          j++;
          continue;
        }
        if (code === 0) {
          currentFg = undefined;
          currentBg = undefined;
          currentAttrs = TextAttributes.NONE;
        } else if (code === 1) {
          currentAttrs |= TextAttributes.BOLD;
        } else if (code === 2) {
          currentAttrs |= TextAttributes.DIM;
        } else if (code === 3) {
          currentAttrs |= TextAttributes.ITALIC;
        } else if (code === 4) {
          currentAttrs |= TextAttributes.UNDERLINE;
        } else if (code === 9) {
          currentAttrs |= TextAttributes.STRIKETHROUGH;
        } else if (code === 22) {
          currentAttrs &= ~(TextAttributes.BOLD | TextAttributes.DIM);
        } else if (code === 23) {
          currentAttrs &= ~TextAttributes.ITALIC;
        } else if (code === 24) {
          currentAttrs &= ~TextAttributes.UNDERLINE;
        } else if (code === 29) {
          currentAttrs &= ~TextAttributes.STRIKETHROUGH;
        } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          const rgb = ANSI_COLORS[code];
          if (rgb) currentFg = RGBA.fromInts(rgb[0], rgb[1], rgb[2], 255);
        } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
          const rgb = ANSI_COLORS[code];
          if (rgb) currentBg = RGBA.fromInts(rgb[0], rgb[1], rgb[2], 255);
        } else if (code === 38 || code === 48) {
          const colorType = codes[j + 1];
          if (colorType === 5) {
            const index = codes[j + 2];
            if (index !== undefined) {
              const rgb = ansi256ToRgb(index);
              const color = RGBA.fromInts(rgb[0], rgb[1], rgb[2], 255);
              if (code === 38) currentFg = color;
              else currentBg = color;
              j += 2;
            }
          } else if (colorType === 2) {
            const r = codes[j + 2];
            const g = codes[j + 3];
            const b = codes[j + 4];
            if (r !== undefined && g !== undefined && b !== undefined) {
              const color = RGBA.fromInts(r, g, b, 255);
              if (code === 38) currentFg = color;
              else currentBg = color;
              j += 4;
            }
          }
        } else if (code === 39) {
          currentFg = undefined;
        } else if (code === 49) {
          currentBg = undefined;
        }
        j++;
      }
    } else {
      currentText += input[i];
      i++;
    }
  }
  pushChunk();

  return new StyledText(chunks);
}

async function runStarship(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("starship", ["prompt"], {
      cwd,
      env: process.env,
    });
    let output = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`starship exited with ${code}`));
        return;
      }
      // Strip shell non-printing escape sequences %{…%} and everything after first newline
      const cleaned = output.replace(/%\{(.*?)%\}/g, "$1").trimStart();
      const firstLine = cleaned.split("\n")[0] ?? "";
      resolve(firstLine.trimEnd());
    });
    proc.on("error", (err) => reject(err));
  });
}

function StarshipLine(props: {
  cwd: string;
  interval: number;
  version: string;
  defaultColor: RGBA;
}) {
  let textRef: TextRenderable | undefined;
  let intervalId: ReturnType<typeof setInterval>;

  async function refresh() {
    try {
      let output = await runStarship(props.cwd);
      output = output.replace(/\n/g, " ");
      if (textRef) {
        textRef.clear();
        textRef.add(parseAnsi(output, props.defaultColor));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (textRef) {
        textRef.clear();
        textRef.add(`[starship error: ${msg}]`);
      }
    }
  }

  onMount(() => {
    refresh();
    intervalId = setInterval(refresh, props.interval);
  });

  onCleanup(() => clearInterval(intervalId));

  return (
    <box height={1} flexDirection="row" justifyContent="space-between">
      <text
        ref={(el) => {
          textRef = el as TextRenderable;
        }}
      />
      <text content={`opencode v${props.version}`} fg={props.defaultColor} />
    </box>
  );
}

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as {
    interval?: number;
  };

  const interval = Math.max(500, opts.interval ?? 2000);
  const cwd = api.state.path.directory ?? process.cwd();

  api.slots.register({
    slots: {
      home_footer: () => (
        <StarshipLine
          cwd={cwd}
          interval={interval}
          version={api.app.version}
          defaultColor={api.theme.current.textMuted}
        />
      ),
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "starship",
  tui,
};

export default plugin;
