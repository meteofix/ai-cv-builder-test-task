import { checkEnvAccess } from '../../scripts/lib/guards.ts';
import { block, guard } from '../../scripts/lib/hook-io.ts';

// PreToolUse for Read|Grep|Bash: .env files are never read (the deny rule in settings.json is the second layer).
await guard((input) => {
  const reason = checkEnvAccess(input.tool_name ?? '', input.tool_input ?? {});
  if (reason) block(reason);
});
