// Dumb form over a draft the presenter already owns. `editor-points` renders whatever
// `points` it is handed — the presenter's live `weight()` of the draft — and never
// computes anything itself.
import type { AssetVM, ChoreDraft } from "../presenters/ChoreListPresenter.js";

const RECURRENCE_UNITS = ["", "day", "week", "month", "year", "timesPerYear"] as const;

export interface ChoreEditorViewProps {
  readonly draft: ChoreDraft;
  readonly points: number;
  readonly assets: readonly AssetVM[];
  readonly onChange: (patch: Partial<ChoreDraft>) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onDelete: (() => void) | null;
}

export function ChoreEditorView({ draft, points, assets, onChange, onSave, onCancel, onDelete }: ChoreEditorViewProps) {
  return (
    <div className="chore-editor" data-testid="chore-editor" role="dialog" aria-modal="true" aria-label="Chore editor">
      <label>
        Title
        <input
          type="text"
          data-testid="editor-title"
          value={draft.title}
          onChange={(e) => {
            onChange({ title: e.target.value });
          }}
        />
      </label>

      <label>
        Asset
        <select
          data-testid="editor-asset"
          value={draft.assetId}
          onChange={(e) => {
            onChange({ assetId: e.target.value });
          }}
        >
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Time
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          data-testid="editor-time"
          value={draft.time}
          onChange={(e) => {
            onChange({ time: Number(e.target.value) });
          }}
        />
      </label>

      <label>
        Effort
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          data-testid="editor-effort"
          value={draft.effort}
          onChange={(e) => {
            onChange({ effort: Number(e.target.value) });
          }}
        />
      </label>

      <label>
        Priority
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          data-testid="editor-priority"
          value={draft.priority}
          onChange={(e) => {
            onChange({ priority: Number(e.target.value) });
          }}
        />
      </label>

      <label>
        Repeats
        <select
          data-testid="editor-recurrence-unit"
          value={draft.recurrenceUnit}
          onChange={(e) => {
            onChange({ recurrenceUnit: e.target.value });
          }}
        >
          {RECURRENCE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit === "" ? "Never" : unit}
            </option>
          ))}
        </select>
      </label>

      <label>
        Every
        <input
          type="number"
          data-testid="editor-recurrence-n"
          value={draft.recurrenceN}
          onChange={(e) => {
            onChange({ recurrenceN: Number(e.target.value) });
          }}
        />
      </label>

      <label>
        Deadline
        <input
          type="date"
          data-testid="editor-deadline"
          value={draft.deadlineDate}
          onChange={(e) => {
            onChange({ deadlineDate: e.target.value });
          }}
        />
      </label>

      <label>
        Lead time (days)
        <input
          type="number"
          data-testid="editor-lead-time"
          value={draft.leadTimeDays ?? ""}
          onChange={(e) => {
            onChange({ leadTimeDays: e.target.value === "" ? null : Number(e.target.value) });
          }}
        />
      </label>

      <p className="editor-points" data-testid="editor-points">
        {points}
      </p>

      <div className="editor-actions">
        <button type="button" data-testid="editor-save" onClick={onSave}>
          Save
        </button>
        <button type="button" data-testid="editor-cancel" onClick={onCancel}>
          Cancel
        </button>
        {onDelete !== null && (
          <button type="button" className="editor-delete" data-testid="editor-delete" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
