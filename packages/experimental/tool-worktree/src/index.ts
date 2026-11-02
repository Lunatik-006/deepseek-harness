/** Model tool for creating and entering a new Git worktree through the shared runtime. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-worktree'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { approveEscalation, validateEscalationArgs, ESCALATION_TARGETS } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'

/** Cordis plugin name. */
export const name = 'tool-worktree'
/** Services required to register and execute the worktree tool. */
export const inject = ['tools', 'worktrees', 'sandboxPolicy']

const permissions = {
  sandbox_permissions: { type: 'string' as const, enum: [...ESCALATION_TARGETS], description: 'Request the narrowest wider mode for this worktree operation; requires native approval and a justification.' },
  justification: { type: 'string' as const, description: 'Why this exact worktree operation requires wider permissions.' },
}

/**
 * Register create_worktree for model and PTC callers.
 * @param ctx - tool registry and worktree runtime.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'create_worktree',
    description: 'Create and enter a worktree, obeying the configured fresh-base and detached-checkout policy. Existing source changes remain untouched. Use finish_worktree when the task is complete; it preserves unfinished work and unpublished detached commits.',
    parameters: {
      name: { type: 'string', description: 'New branch name, also used as the checkout directory. Omit to generate a unique name.' },
      from: { type: 'string', description: 'Local base when no freshBase policy is configured. Cannot override an operator-required fresh fetch.' },
      detached: { type: 'boolean', description: 'Create a detached checkout instead of a branch; omission follows deployment policy.' },
      ...permissions,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          branch: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          baseCommit: { type: 'string', required: true },
          repositoryRoot: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('create_worktree requires a calling agent')
      validateEscalationArgs(args.sandbox_permissions, args.justification)
      const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session })
      const mode = args.sandbox_permissions === undefined ? policy.mode : await approveEscalation({
        requestedMode: args.sandbox_permissions, justification: args.justification!, effectiveMode: policy.mode, subject: 'worktree operation',
      }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: exec.name, signal: exec.signal })
      return ctx.worktrees.create(exec.agent, args, exec.signal, { ...policy, mode })
    },
    presentCall: args => ({ card: 'generic', title: 'create_worktree', rawInput: args }),
  }))
  ctx.tools.register(defineTool({
    name: 'finish_worktree',
    description: 'Finish this session\'s task checkout after delivery. Remove only its owned clean worktree, keeping all running jobs, children, dirty files and unpublished detached commits. Return to the source project. Never uses force removal.',
    parameters: permissions,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string', enum: ['none', 'removed', 'retained'], required: true },
        path: { type: 'string' }, reason: { type: 'string' },
      } },
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('finish_worktree requires a calling agent')
      validateEscalationArgs(args.sandbox_permissions, args.justification)
      const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session })
      const mode = args.sandbox_permissions === undefined ? undefined : await approveEscalation({
        requestedMode: args.sandbox_permissions, justification: args.justification!, effectiveMode: policy.mode, subject: 'worktree operation',
      }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: exec.name, signal: exec.signal })
      return ctx.worktrees.finish(exec.agent, exec.signal, mode === undefined ? undefined : { ...policy, mode })
    },
    presentCall: args => ({ card: 'generic', title: 'finish_worktree', rawInput: args }),
  }))
}
