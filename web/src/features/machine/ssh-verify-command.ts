/** 供用户在跑 Peri 的本机 Terminal 里手动验证 SSH 登录（可交互密码/API key）。 */

export type SshVerifyCommandInput = {
  destination: string;
  port?: number;
  identityFile?: string;
  /** 粘贴内容里曾带 user:secret@host，需提示在终端输入密码/API key。 */
  interactivePassword?: boolean;
};

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./~=@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildSshVerifyShellCommand(input: SshVerifyCommandInput): string {
  const destination = input.destination.trim();
  if (!destination) return 'ssh';

  const parts = ['ssh'];
  if (input.port !== undefined && input.port > 0) {
    parts.push('-p', String(input.port));
  }
  const identity = input.identityFile?.trim();
  if (identity) {
    parts.push('-i', quoteShellArg(identity));
  }
  if (input.interactivePassword) {
    parts.push('-o', 'PreferredAuthentications=publickey,password,keyboard-interactive');
  }
  parts.push(quoteShellArg(destination));
  return parts.join(' ');
}

/** 私钥已在文件中时，加入 ssh-agent 以便 Peri BatchMode 连接。 */
export function buildSshAddKeyCommand(identityFile: string): string {
  const path = identityFile.trim();
  if (!path) return 'ssh-add /path/to/private_key';
  return `ssh-add --apple-use-keychain ${quoteShellArg(path)}`;
}

export function shouldOfferSshVerifyCommand(input: {
  destination: string;
  credentialStripped: boolean;
  identityFile?: string;
}): boolean {
  if (!input.destination.trim()) return false;
  if (input.credentialStripped) return true;
  const identity = input.identityFile?.trim();
  if (!identity) return false;
  return identity.startsWith('~');
}
