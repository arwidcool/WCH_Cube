#!/usr/bin/env bash
# Launch the four agents in tmux, each in its own git worktree, with permission prompts disabled.
# Usage: ./agents/run_agents.sh            (from the repo root, on a machine you trust an agent with)
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
mkdir -p ~/.claude
python3 - <<'PY'
import json,os,pathlib
p=pathlib.Path.home()/'.claude'/'settings.json'
d=json.loads(p.read_text()) if p.exists() else {}
d['skipDangerousModePermissionPrompt']=True          # suppress the one-time bypass warning
d.setdefault('permissions',{})['defaultMode']='bypassPermissions'
p.write_text(json.dumps(d,indent=2))
PY
git branch --list 'agent/*' | grep -q . || for b in data engine ui qa; do git branch "agent/$b" main 2>/dev/null || true; done
declare -A W=( [1]=data [2]=engine [3]=ui [4]=qa )
declare -A F=( [1]=AGENT_1_DATA.md [2]=AGENT_2_ENGINE.md [3]=AGENT_3_UI.md [4]=AGENT_4_QA_RELEASE.md )
tmux new-session -d -s wchcube -n control "echo 'WCH_CubeMX swarm. Attach with: tmux attach -t wchcube'; bash"
for n in 1 2 3 4; do
  WT="../wchcube-${W[$n]}"
  [ -d "$WT" ] || git worktree add "$WT" "agent/${W[$n]}"
  PROMPT="You are AGENT-$n. Repo root is $(realpath "$WT"). Read agents/README.md, then agents/${F[$n]}, then TASKS.md and agents/BOARD.md. Start the work cycle now and keep looping until agents/BOARD.md contains 'PROJECT DONE'. Never ask the human anything; decide and log on the board."
  tmux new-window -t wchcube -n "agent$n" "cd $WT && claude --permission-mode bypassPermissions --dangerously-skip-permissions \"$PROMPT\"; bash"
done
echo "Started. tmux attach -t wchcube   (windows: control, agent1..agent4)"
