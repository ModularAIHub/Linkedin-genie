import React, { useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Pencil,
  Save,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  STATUS_STYLES,
  buildDefaultScheduleTime,
  formatDateTime,
} from './contentPlanUtils';

export default function ContentPlanQueueSection({
  filteredQueue = [],
  contentPlanRunId = null,
  queueStatusFilter = '',
  onQueueStatusFilterChange = () => {},
  onOpenPrompts = () => {},
  onGenerateContentPlan = () => {},
  generatingContentPlan = false,
  scheduleInputs = {},
  timezone = 'UTC',
  actionLoadingId = '',
  onUpdateScheduleInput = () => {},
  onQueueAction = () => {},
  onUseInCompose = () => {},
}) {
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState({
    title: '',
    content: '',
    hashtagsText: '',
    reason: '',
  });

  const startEditing = (item) => {
    setEditingId(item?.id || '');
    setEditDraft({
      title: String(item?.title || '').trim(),
      content: String(item?.content || '').trim(),
      hashtagsText: Array.isArray(item?.hashtags) ? item.hashtags.join(', ') : '',
      reason: String(item?.reason || '').trim(),
    });
  };

  const cancelEditing = () => {
    setEditingId('');
    setEditDraft({
      title: '',
      content: '',
      hashtagsText: '',
      reason: '',
    });
  };

  const saveEditing = async (item) => {
    const hashtags = String(editDraft.hashtagsText || '')
      .split(/[,\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    await onQueueAction(item, 'update', {
      title: editDraft.title,
      content: editDraft.content,
      hashtags,
      reason: editDraft.reason,
    });

    cancelEditing();
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">Publish-ready queue</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onGenerateContentPlan}
            disabled={generatingContentPlan}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {generatingContentPlan ? 'Generating...' : 'Generate Content Plan'}
          </button>
          <button
            type="button"
            onClick={onOpenPrompts}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Open Prompt Pack
          </button>
          <select
            value={queueStatusFilter}
            onChange={(event) => onQueueStatusFilterChange(String(event.target.value || ''))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">All statuses</option>
            <option value="needs_approval">Needs approval</option>
            <option value="approved">Approved</option>
            <option value="done">Done (scheduled + posted)</option>
            <option value="scheduled">Scheduled</option>
            <option value="posted">Posted</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {!contentPlanRunId && filteredQueue.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600">
          No content plan generated yet. Click Generate Content Plan to create publish-ready posts here.
        </div>
      ) : filteredQueue.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No queue items match this filter.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredQueue.map((item) => {
            const isBusy = actionLoadingId === item.id;
            const isEditing = editingId === item.id;
            const scheduleState = scheduleInputs[item.id] || {
              scheduled_time: buildDefaultScheduleTime(),
              timezone,
            };
            const statusLabel = item.status === 'scheduled'
              ? 'done (scheduled)'
              : item.status === 'completed'
                ? 'done (completed)'
              : item.status === 'posted'
                ? 'done (posted)'
                : item.status;

            return (
              <div key={item.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editDraft.title}
                        onChange={(event) => setEditDraft((prev) => ({ ...prev, title: event.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900"
                        placeholder="Post title"
                      />
                    ) : (
                      <h4 className="font-semibold text-gray-900">{item.title || 'Untitled queue item'}</h4>
                    )}
                    <p className="text-xs text-gray-500">Created {formatDateTime(item.createdAt)}</p>
                  </div>
                  <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[item.status] || STATUS_STYLES.draft}`}>
                    {statusLabel}
                  </span>
                </div>

                {isEditing ? (
                  <textarea
                    rows={8}
                    value={editDraft.content}
                    onChange={(event) => setEditDraft((prev) => ({ ...prev, content: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800"
                    placeholder="Edit post content..."
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-gray-700">{item.content}</p>
                )}

                {isEditing ? (
                  <input
                    type="text"
                    value={editDraft.hashtagsText}
                    onChange={(event) => setEditDraft((prev) => ({ ...prev, hashtagsText: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                    placeholder="Hashtags (comma-separated)"
                  />
                ) : item.hashtags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {item.hashtags.map((tag) => (
                      <span key={`${item.id}-${tag}`} className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700 border border-blue-100">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {isEditing ? (
                  <input
                    type="text"
                    value={editDraft.reason}
                    onChange={(event) => setEditDraft((prev) => ({ ...prev, reason: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                    placeholder="Reason / angle (optional)"
                  />
                ) : item.reason ? (
                  <p className="text-xs text-gray-500">
                    <strong>Reason:</strong> {item.reason}
                  </p>
                ) : null}

                {(item.suggestedDayOffset || item.suggestedLocalTime) && (
                  <p className="text-xs text-gray-500">
                    <strong>Suggested schedule:</strong> Day +{Number(item.suggestedDayOffset || 0)} at {item.suggestedLocalTime || '09:00'}
                  </p>
                )}

                {item.rejectionReason && (
                  <p className="text-xs text-rose-700">
                    <strong>Rejected:</strong> {item.rejectionReason}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {(item.status === 'needs_approval' || item.status === 'draft' || item.status === 'rejected' || item.status === 'approved') && (
                    !isEditing ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => startEditing(item)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isBusy || !String(editDraft.content || '').trim()}
                          onClick={() => saveEditing(item)}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          <Save className="h-3.5 w-3.5" />
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={cancelEditing}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancel edit
                        </button>
                      </>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => onUseInCompose(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Use in Compose
                  </button>

                  {(item.status === 'needs_approval' || item.status === 'draft' || item.status === 'rejected') && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onQueueAction(item, 'approve')}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve
                    </button>
                  )}
                  {(item.status === 'needs_approval' || item.status === 'draft' || item.status === 'approved') && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onQueueAction(item, 'reject')}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </button>
                  )}
                </div>

                {item.status === 'approved' && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
                      <CalendarClock className="h-4 w-4" />
                      Schedule approved item
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="datetime-local"
                        value={scheduleState.scheduled_time}
                        onChange={(event) => onUpdateScheduleInput(item.id, 'scheduled_time', event.target.value)}
                        className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        value={scheduleState.timezone}
                        onChange={(event) => onUpdateScheduleInput(item.id, 'timezone', event.target.value)}
                        className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                        placeholder="Timezone (e.g. Asia/Kolkata)"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onQueueAction(item, 'schedule')}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      Schedule for publish
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
