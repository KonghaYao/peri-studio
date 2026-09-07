/**
 * 将用户粘贴的 `ssh …` 命令或 destination 解析为 machine/add 参数字段。
 * 与 server `validate_ssh_destination` / `validate_identity_file_path` 对齐。
 */

export type ParsedSshCommand = {
  destination: string;
  port?: number;
  identityFile?: string;
  warnings: string[];
  /** 输入里曾含 user:password@host / user:apikey@host，密钥已剥离。 */
  credentialStripped: boolean;
};

export type ParseSshCommandResult =
  | { ok: true; value: ParsedSshCommand }
  | { ok: false; error: string };

const CREDENTIAL_STRIPPED_WARNING =
  'Passwords and API keys are not stored. Only the username and host were kept—use ssh-agent or an identity file.';

const UNSUPPORTED_OPTION_PREFIXES = [
  'proxycommand',
  'proxyjump',
  'jump',
  'remotecommand',
  'passwordauthentication',
];

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parsePortValue(raw: string): number | undefined {
  const value = raw.trim();
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  if (port < 1 || port > 65535) return undefined;
  return port;
}

function applyOption(
  name: string,
  value: string | undefined,
  state: { port?: number; identityFile?: string; loginUser?: string },
): string | null {
  const key = name.toLowerCase();
  if (UNSUPPORTED_OPTION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return `SSH option "${name}" is not supported in Peri.`;
  }
  if (key === 'port' && value) {
    const port = parsePortValue(value);
    if (port === undefined) return 'Invalid Port in SSH command.';
    state.port = port;
    return null;
  }
  if (key === 'identityfile' && value) {
    state.identityFile = value;
    return null;
  }
  if (key === 'user' && value) {
    state.loginUser = value;
    return null;
  }
  return null;
}

function consumeShortFlag(
  flagBody: string,
  state: { port?: number; identityFile?: string; loginUser?: string },
): string | null {
  if (flagBody.startsWith('p') && flagBody.length > 1) {
    const port = parsePortValue(flagBody.slice(1));
    if (port === undefined) return 'Invalid -p port in SSH command.';
    state.port = port;
    return null;
  }
  if (flagBody.startsWith('i') && flagBody.length > 1) {
    state.identityFile = flagBody.slice(1);
    return null;
  }
  if (flagBody.startsWith('l') && flagBody.length > 1) {
    state.loginUser = flagBody.slice(1);
    return null;
  }
  if (flagBody.startsWith('o') && flagBody.length > 1) {
    const option = flagBody.slice(1);
    const eq = option.indexOf('=');
    if (eq === -1) return `SSH option "-o ${option}" needs a value.`;
    return applyOption(option.slice(0, eq), option.slice(eq + 1), state);
  }
  return null;
}

/** 剥离 user:password@host / user:apikey@host 中的密钥，只保留 user@host。 */
export function stripEmbeddedSshCredential(destination: string): { destination: string; strippedCredential: boolean } {
  const at = destination.lastIndexOf('@');
  if (at <= 0) return { destination, strippedCredential: false };
  const userPart = destination.slice(0, at);
  const hostPart = destination.slice(at + 1);
  if (!userPart.includes(':')) return { destination, strippedCredential: false };
  const user = userPart.split(':')[0]?.trim();
  if (!user || !hostPart.trim()) {
    return { destination, strippedCredential: false };
  }
  return { destination: `${user}@${hostPart.trim()}`, strippedCredential: true };
}

function mergeLoginUser(destination: string, loginUser?: string): string {
  if (!loginUser?.trim()) return destination;
  if (destination.includes('@')) return destination;
  return `${loginUser.trim()}@${destination}`;
}

function validateDestinationShape(destination: string): string | null {
  if (!destination) return 'Destination is required.';
  if (destination.length > 255) return 'Destination is too long.';
  if (destination.startsWith('-')) return 'Destination must not start with "-".';
  if (destination.includes('://')) return 'Destination must not contain a URL scheme.';
  if (/\s/.test(destination)) return 'Destination contains invalid characters.';
  const { destination: stripped, strippedCredential } = stripEmbeddedSshCredential(destination);
  if (strippedCredential && !stripped.includes('@')) {
    return 'Enter a valid SSH destination (user@host or config Host).';
  }
  return null;
}

function identityWarnings(identityFile?: string): string[] {
  if (!identityFile?.startsWith('~')) return [];
  return ['Identity paths with ~ are not stored. Use the full path on this Mac.'];
}

export function parseSshCommandInput(raw: string): ParseSshCommandResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Destination is required.' };
  }

  const warnings: string[] = [];
  let tokens = tokenize(trimmed);
  if (tokens[0]?.toLowerCase() === 'ssh') {
    tokens = tokens.slice(1);
  }

  const state: { port?: number; identityFile?: string; loginUser?: string } = {};
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--') {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      return { ok: false, error: `Long SSH options such as "${token}" are not supported.` };
    }
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const flag = token.slice(1);
    if (flag === 'p' || flag === 'i' || flag === 'l' || flag === 'F' || flag === 'o') {
      const value = tokens[i + 1];
      if (!value || value.startsWith('-')) {
        return { ok: false, error: `SSH flag "-${flag}" requires a value.` };
      }
      if (flag === 'o') {
        const eq = value.indexOf('=');
        if (eq === -1) {
          return { ok: false, error: `SSH option "-o ${value}" must use Name=Value form.` };
        }
        const err = applyOption(value.slice(0, eq), value.slice(eq + 1), state);
        if (err) return { ok: false, error: err };
      } else if (flag === 'p') {
        const port = parsePortValue(value);
        if (port === undefined) return { ok: false, error: 'Invalid -p port in SSH command.' };
        state.port = port;
      } else if (flag === 'i') {
        state.identityFile = value;
      } else if (flag === 'l') {
        state.loginUser = value;
      }
      i += 1;
      continue;
    }

    const shortErr = consumeShortFlag(flag, state);
    if (shortErr) return { ok: false, error: shortErr };
  }

  if (positionals.length === 0) {
    return { ok: false, error: 'Missing SSH destination (user@host or Host alias).' };
  }

  if (positionals.length > 1) {
    warnings.push('Remote commands in the SSH line are ignored.');
  }

  let destination = mergeLoginUser(positionals[0], state.loginUser);
  const shapeError = validateDestinationShape(destination);
  if (shapeError) return { ok: false, error: shapeError };

  const stripped = stripEmbeddedSshCredential(destination);
  destination = stripped.destination;
  const credentialStripped = stripped.strippedCredential;
  if (credentialStripped) {
    warnings.push(CREDENTIAL_STRIPPED_WARNING);
  }

  warnings.push(...identityWarnings(state.identityFile));

  return {
    ok: true,
    value: {
      destination,
      port: state.port,
      identityFile: state.identityFile,
      warnings,
      credentialStripped,
    },
  };
}

/** 解析并写入表单字段；返回是否成功解析。 */
export function applyParsedSshToFields(
  raw: string,
  setters: {
    setDestination: (value: string) => void;
    setPort: (value: string) => void;
    setIdentityFile: (value: string) => void;
    setParseWarnings: (value: string[]) => void;
    setParseError: (value: string | null) => void;
    setCredentialStripped?: (value: boolean) => void;
  },
): boolean {
  const parsed = parseSshCommandInput(raw);
  if (!parsed.ok) {
    setters.setParseError(parsed.error);
    setters.setParseWarnings([]);
    setters.setCredentialStripped?.(false);
    return false;
  }
  setters.setDestination(parsed.value.destination);
  setters.setPort(parsed.value.port ? String(parsed.value.port) : '');
  setters.setIdentityFile(parsed.value.identityFile ?? '');
  setters.setParseWarnings(parsed.value.warnings);
  setters.setCredentialStripped?.(parsed.value.credentialStripped);
  setters.setParseError(null);
  return true;
}
