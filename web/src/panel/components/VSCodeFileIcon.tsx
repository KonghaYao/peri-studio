import { Icon } from '@iconify-icon/solid';
import defaultFile from '@iconify-icons/vscode-icons/default-file';
import defaultFolder from '@iconify-icons/vscode-icons/default-folder';
import defaultFolderOpened from '@iconify-icons/vscode-icons/default-folder-opened';
import css from '@iconify-icons/vscode-icons/file-type-css';
import deno from '@iconify-icons/vscode-icons/file-type-deno';
import docker from '@iconify-icons/vscode-icons/file-type-docker';
import dotenv from '@iconify-icons/vscode-icons/file-type-dotenv';
import git from '@iconify-icons/vscode-icons/file-type-git';
import go from '@iconify-icons/vscode-icons/file-type-go';
import html from '@iconify-icons/vscode-icons/file-type-html';
import image from '@iconify-icons/vscode-icons/file-type-image';
import javascript from '@iconify-icons/vscode-icons/file-type-js';
import json from '@iconify-icons/vscode-icons/file-type-json';
import markdown from '@iconify-icons/vscode-icons/file-type-markdown';
import npm from '@iconify-icons/vscode-icons/file-type-npm';
import pdf from '@iconify-icons/vscode-icons/file-type-pdf2';
import python from '@iconify-icons/vscode-icons/file-type-python';
import reactjs from '@iconify-icons/vscode-icons/file-type-reactjs';
import reactts from '@iconify-icons/vscode-icons/file-type-reactts';
import rust from '@iconify-icons/vscode-icons/file-type-rust';
import scss from '@iconify-icons/vscode-icons/file-type-scss';
import shell from '@iconify-icons/vscode-icons/file-type-shell';
import sql from '@iconify-icons/vscode-icons/file-type-sql';
import svelte from '@iconify-icons/vscode-icons/file-type-svelte';
import svg from '@iconify-icons/vscode-icons/file-type-svg';
import textIcon from '@iconify-icons/vscode-icons/file-type-text';
import toml from '@iconify-icons/vscode-icons/file-type-toml';
import typescript from '@iconify-icons/vscode-icons/file-type-typescript';
import typescriptdef from '@iconify-icons/vscode-icons/file-type-typescriptdef';
import vue from '@iconify-icons/vscode-icons/file-type-vue';
import xml from '@iconify-icons/vscode-icons/file-type-xml';
import yaml from '@iconify-icons/vscode-icons/file-type-yaml';
import bun from '@iconify-icons/vscode-icons/file-type-bun';
import folderConfig from '@iconify-icons/vscode-icons/folder-type-config';
import folderConfigOpened from '@iconify-icons/vscode-icons/folder-type-config-opened';
import folderDist from '@iconify-icons/vscode-icons/folder-type-dist';
import folderDistOpened from '@iconify-icons/vscode-icons/folder-type-dist-opened';
import folderDocs from '@iconify-icons/vscode-icons/folder-type-docs';
import folderDocsOpened from '@iconify-icons/vscode-icons/folder-type-docs-opened';
import folderGit from '@iconify-icons/vscode-icons/folder-type-git';
import folderGitOpened from '@iconify-icons/vscode-icons/folder-type-git-opened';
import folderGithub from '@iconify-icons/vscode-icons/folder-type-github';
import folderGithubOpened from '@iconify-icons/vscode-icons/folder-type-github-opened';
import folderNode from '@iconify-icons/vscode-icons/folder-type-node';
import folderNodeOpened from '@iconify-icons/vscode-icons/folder-type-node-opened';
import folderPublic from '@iconify-icons/vscode-icons/folder-type-public';
import folderPublicOpened from '@iconify-icons/vscode-icons/folder-type-public-opened';
import folderScript from '@iconify-icons/vscode-icons/folder-type-script';
import folderScriptOpened from '@iconify-icons/vscode-icons/folder-type-script-opened';
import folderSrc from '@iconify-icons/vscode-icons/folder-type-src';
import folderSrcOpened from '@iconify-icons/vscode-icons/folder-type-src-opened';
import folderTest from '@iconify-icons/vscode-icons/folder-type-test';
import folderTestOpened from '@iconify-icons/vscode-icons/folder-type-test-opened';
import folderVscode from '@iconify-icons/vscode-icons/folder-type-vscode';
import folderVscodeOpened from '@iconify-icons/vscode-icons/folder-type-vscode-opened';
import { vscodeFileIconKind, vscodeFolderIconKind, type VSCodeFileIconKind, type VSCodeFolderIconKind } from '../lib/vscode-file-icons';

type VSCodeIconData = typeof defaultFile;

const FILE_ICONS: Record<VSCodeFileIconKind, VSCodeIconData> = {
  typescript, typescriptdef, reactts, javascript, reactjs, rust, markdown, json, yaml, shell,
  dotenv, docker, html, css, scss, python, go, toml, git, npm, bun, deno, image, svg,
  text: textIcon, pdf, sql, xml, vue, svelte, 'default-file': defaultFile,
};

const FOLDER_ICONS: Record<VSCodeFolderIconKind, VSCodeIconData> = {
  'folder-src': folderSrc, 'folder-src-opened': folderSrcOpened,
  'folder-node': folderNode, 'folder-node-opened': folderNodeOpened,
  'folder-public': folderPublic, 'folder-public-opened': folderPublicOpened,
  'folder-docs': folderDocs, 'folder-docs-opened': folderDocsOpened,
  'folder-script': folderScript, 'folder-script-opened': folderScriptOpened,
  'folder-test': folderTest, 'folder-test-opened': folderTestOpened,
  'folder-git': folderGit, 'folder-git-opened': folderGitOpened,
  'folder-github': folderGithub, 'folder-github-opened': folderGithubOpened,
  'folder-vscode': folderVscode, 'folder-vscode-opened': folderVscodeOpened,
  'folder-config': folderConfig, 'folder-config-opened': folderConfigOpened,
  'folder-dist': folderDist, 'folder-dist-opened': folderDistOpened,
  'default-folder': defaultFolder, 'default-folder-opened': defaultFolderOpened,
};

export function VSCodeFileIcon(props: { path: string; directory?: boolean; open?: boolean; size?: number; class?: string }) {
  const kind = () => props.directory ? vscodeFolderIconKind(props.path, !!props.open) : vscodeFileIconKind(props.path);
  const icon = () => props.directory ? FOLDER_ICONS[kind() as VSCodeFolderIconKind] : FILE_ICONS[kind() as VSCodeFileIconKind];
  const size = () => props.size ?? 16;
  return <span class={`inline-grid shrink-0 place-items-center ${props.class ?? ''}`} data-file-icon={kind()} aria-hidden="true">
    <Icon icon={icon()} width={size()} height={size()} />
  </span>;
}
