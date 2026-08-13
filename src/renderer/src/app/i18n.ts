import type { AppLanguage } from '../../../shared/types'

const en = {
  newTask: 'New task', tasks: 'Tasks', virtualScope: 'Virtual Scope', recentTasks: 'Recent Tasks', settings: 'Settings',
  welcome: 'What should we build in Motra?', placeholder: 'Describe a task, ask about code, or analyze motor data…',
  noWorkspace: 'No workspace', openFolder: 'Open folder…', clearWorkspace: 'Clear workspace', local: 'Local', localHelp: 'This task runs locally on your computer.',
  noGit: 'No Git repository', attachSoon: 'Attachments are coming soon.', permissionSoon: 'Permission modes are coming soon.', askChanges: 'Ask before changes',
  send: 'Send', stop: 'Stop', thinking: 'Thinking…', you: 'You', assistant: 'Assistant',
  rename: 'Rename', delete: 'Delete', cancel: 'Cancel', confirm: 'Confirm', deleteTask: 'Delete task?', deleteHint: 'This permanently removes the task and its message history.',
  searchTasks: 'Search tasks', noTasks: 'No tasks yet', noResults: 'No matching tasks', untitled: 'Untitled',
  scopeOffline: 'Scope offline', scopeConnected: 'Scope connected', apiKey: 'API Key', baseUrl: 'Anthropic-compatible Base URL', maxTokens: 'Max Tokens',
  defaultModel: 'Default model', models: 'Local model list', systemPrompt: 'System Prompt', language: 'Language', saveChanges: 'Save changes', saved: 'Settings saved',
  saveFailed: 'Could not save settings', unsavedTitle: 'Discard unsaved changes?', unsavedHint: 'Your settings edits have not been saved.', discard: 'Discard', back: 'Back',
  addModel: 'Add model', removeModel: 'Remove model', workspace: 'Workspace', model: 'Model', updated: 'Updated', messages: 'messages',
  switchWorkspace: 'Change workspace?', switchWorkspaceHint: 'The new workspace will be used by future messages in this task.', clearWorkspaceTitle: 'Clear workspace?',
  sendFailed: 'Send failed', loadingFailed: 'Could not load Motra data', invalidTitle: 'Title cannot be empty', settingsDescription: 'Provider, models, prompt, and language',
  modelRequired: 'Keep at least one model.', defaultRequired: 'Choose another default model before removing this one.'
} as const

type TranslationKey = keyof typeof en
const zh: Record<TranslationKey, string> = {
  newTask: '新建任务', tasks: '任务', virtualScope: '虚拟示波器', recentTasks: '最近任务', settings: '设置',
  welcome: '今天想在 Motra 中构建什么？', placeholder: '描述任务、询问代码或分析电机数据…',
  noWorkspace: '未选择工作区', openFolder: '打开文件夹…', clearWorkspace: '清除工作区', local: '本地', localHelp: '此任务在你的电脑上本地运行。',
  noGit: '不是 Git 仓库', attachSoon: '附件功能正在开发中。', permissionSoon: '权限模式正在开发中。', askChanges: '更改前询问',
  send: '发送', stop: '停止', thinking: '思考中…', you: '你', assistant: '助手',
  rename: '重命名', delete: '删除', cancel: '取消', confirm: '确认', deleteTask: '删除任务？', deleteHint: '这会永久删除任务及其消息历史。',
  searchTasks: '搜索任务', noTasks: '还没有任务', noResults: '没有匹配的任务', untitled: '未命名',
  scopeOffline: '示波器离线', scopeConnected: '示波器已连接', apiKey: 'API Key', baseUrl: 'Anthropic 兼容 Base URL', maxTokens: '最大 Tokens',
  defaultModel: '默认模型', models: '本地模型列表', systemPrompt: '系统提示词', language: '语言', saveChanges: '保存更改', saved: '设置已保存',
  saveFailed: '设置保存失败', unsavedTitle: '放弃未保存的更改？', unsavedHint: '设置表单中的修改尚未保存。', discard: '放弃', back: '返回',
  addModel: '添加模型', removeModel: '删除模型', workspace: '工作区', model: '模型', updated: '更新于', messages: '条消息',
  switchWorkspace: '更改工作区？', switchWorkspaceHint: '之后的消息将使用新的工作区。', clearWorkspaceTitle: '清除工作区？',
  sendFailed: '发送失败', loadingFailed: 'Motra 数据加载失败', invalidTitle: '标题不能为空', settingsDescription: 'Provider、模型、提示词与语言',
  modelRequired: '至少保留一个模型。', defaultRequired: '删除前请先选择其他默认模型。'
}

export function translate(language: AppLanguage, key: TranslationKey): string { return language === 'zh-CN' ? zh[key] : en[key] }
export type { TranslationKey }
