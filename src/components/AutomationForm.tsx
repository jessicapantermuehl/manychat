import { saveAutomation } from "@/app/actions";
import type { Automation, IgAccount } from "@/lib/types";

interface Props {
  automation?: Automation;
  accounts: IgAccount[];
  envIgUserId?: string;
}

export function AutomationForm({ automation, accounts, envIgUserId }: Props) {
  const accountOptions = accounts.length
    ? accounts
    : envIgUserId
      ? [{ igUserId: envIgUserId, username: "env token account", accessToken: "", tokenExpiresAt: null }]
      : [];

  return (
    <form action={saveAutomation} className="stack">
      {automation?.id && <input type="hidden" name="id" value={automation.id} />}

      <label>
        Name
        <input type="text" name="name" defaultValue={automation?.name ?? ""} placeholder="Gut health guide – Reel 14 Sept" required />
      </label>

      <div className="row">
        <label>
          Instagram account
          <select name="igUserId" defaultValue={automation?.igUserId ?? accountOptions[0]?.igUserId ?? ""} required>
            {accountOptions.map((a) => (
              <option key={a.igUserId} value={a.igUserId}>
                @{a.username} ({a.igUserId})
              </option>
            ))}
          </select>
          {accountOptions.length === 0 && <span className="help">Connect an account first (button on the home page).</span>}
        </label>
        <label>
          Post / Reel ID
          <input type="text" name="mediaId" defaultValue={automation?.mediaId ?? ""} placeholder="Leave empty for every post" />
          <span className="help">Find it via the media picker on the home page.</span>
        </label>
      </div>

      <div className="row">
        <label>
          Trigger keywords
          <input type="text" name="keywords" defaultValue={automation?.keywords.join(", ") ?? ""} placeholder="guide, GUIDE, 🔥" />
          <span className="help">Comma-separated. Leave empty to trigger on every comment.</span>
        </label>
        <label>
          Match mode
          <select name="matchMode" defaultValue={automation?.matchMode ?? "contains"}>
            <option value="contains">Comment contains the keyword</option>
            <option value="exact">Comment is exactly the keyword</option>
          </select>
        </label>
      </div>

      <label>
        Public replies (one per line, picked at random)
        <textarea
          name="publicReplies"
          defaultValue={automation?.publicReplies.join("\n") ?? "Sent it to your DMs! 💌\nCheck your inbox 📩\nJust sent you the link! ✨"}
        />
        <span className="help">Replying publicly boosts the post and tells other people what to comment. Leave empty to skip.</span>
      </label>

      <label>
        DM text
        <textarea
          name="dmText"
          required
          defaultValue={automation?.dmText ?? "Hey {{username}}! Here's the guide you asked for: {{link}}"}
        />
        <span className="help">
          Use <code>{"{{username}}"}</code> and <code>{"{{link}}"}</code> as placeholders.
        </span>
      </label>

      <div className="row">
        <label>
          Link
          <input type="url" name="dmLink" defaultValue={automation?.dmLink ?? ""} placeholder="https://..." />
        </label>
        <label>
          Button title (optional)
          <input type="text" name="dmButtonTitle" defaultValue={automation?.dmButtonTitle ?? ""} placeholder="Get the guide" maxLength={20} />
          <span className="help">If set, the DM is sent with a tappable button instead of a plain link.</span>
        </label>
      </div>

      <label className="check">
        <input type="checkbox" name="ignoreReplies" defaultChecked={automation?.ignoreReplies ?? true} />
        Ignore comments that are replies to other comments
      </label>
      <label className="check">
        <input type="checkbox" name="active" defaultChecked={automation?.active ?? true} />
        Active
      </label>

      <div className="actions">
        <button className="btn" type="submit">Save automation</button>
        <a className="btn secondary" href="/">Cancel</a>
      </div>
    </form>
  );
}
