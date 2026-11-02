# Issue automation

Two GitHub workflows let Claude help with issues. Both start only on an action by the repository owner, so nothing runs because of what a stranger writes.

| Workflow | Starts when | What Claude does |
|---|---|---|
| `claude-investigate.yml` | The owner adds the label `claude` to an issue | Reads the issue and the code and posts one comment: likely cause, suggested fix, questions. Cannot change files. |
| `claude-fix.yml` | The owner writes `@claude ...` in a comment | Works on a `claude/` branch and opens a pull request. The owner reviews and merges, as with any change. |

Issue text is written by people outside the project, so the investigation treats it as untrusted data and has read access to the code only.

## Set-up (once, by the owner)
1. Run `claude setup-token` on a computer where Claude Code is signed in with a Pro or Max subscription, and copy the token.
2. In the repository: Settings, Secrets and variables, Actions, New repository secret. Name `CLAUDE_CODE_OAUTH_TOKEN`, value the token.
3. Install the Claude GitHub app (https://github.com/apps/claude) on this repository only.
4. Test: add the label `claude` to an issue and check the Actions tab.

## Notes
- The runs use the owner's subscription allowance; there is no separate bill. Revoke the token and replace the secret if it may have leaked.
- The Claude action is pinned to a commit. Update the commit on purpose after reading the release notes.
- Workflow files cannot be changed by the Claude app (GitHub does not give it that permission), so changes to these files go through a normal pull request.
