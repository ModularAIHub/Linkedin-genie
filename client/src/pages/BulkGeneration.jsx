
import React, { useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import api from '../utils/api';

const BulkGeneration = () => {
  const [prompts, setPrompts] = useState(['']);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePromptChange = (idx, value) => {
    setPrompts(prompts => prompts.map((p, i) => (i === idx ? value : p)));
  };

  const addPrompt = () => setPrompts(prompts => [...prompts, '']);
  const removePrompt = idx => setPrompts(prompts => prompts.filter((_, i) => i !== idx));

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setResults([]);
    try {
      const res = await api.post('/api/ai/bulk-generate', { prompts });
      setResults(res.data.results || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Bulk generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Bulk AI Content Generation</h1>
      <p className="mb-6 text-gray-600">Enter multiple prompts below. Generate LinkedIn posts in bulk.</p>
      {prompts.map((prompt, idx) => (
        <div key={idx} className="flex items-center mb-2 gap-2">
          <textarea
            className="flex-1 px-3 py-2 border rounded"
            value={prompt}
            onChange={e => handlePromptChange(idx, e.target.value)}
            placeholder={`Prompt #${idx + 1}`}
            rows={2}
          />
          {prompts.length > 1 && (
            <button className="btn btn-danger" onClick={() => removePrompt(idx)}>-</button>
          )}
        </div>
      ))}
      <button className="btn btn-primary mb-4" onClick={addPrompt}>Add Prompt</button>
      <div className="mb-4">
        <button className="btn btn-success" onClick={handleGenerate} disabled={loading || prompts.every(p => !p.trim())}>
          {loading ? <LoadingSpinner size="sm" /> : 'Generate All'}
        </button>
      </div>
      {error && <div className="text-red-500 mb-4">{error}</div>}
      {results.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">Results</h2>
          <ul className="space-y-4">
            {results.map((result, idx) => (
              <BulkResultItem key={idx} idx={idx} result={result} />
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

function BulkResultItem({ idx, result }) {
  const [scheduleDate, setScheduleDate] = React.useState('');
  const [scheduleTime, setScheduleTime] = React.useState('09:00');
  const [scheduling, setScheduling] = React.useState(false);
  const [scheduleError, setScheduleError] = React.useState('');

  const content = result?.result?.content || result?.content || 'No content generated.';

  const handleSchedule = async () => {
    setScheduling(true);
    setScheduleError('');
    try {
      // TODO: Implement actual scheduling API call
      // Example payload:
      // { content, scheduled_for: `${scheduleDate}T${scheduleTime}` }
      // await api.post('/api/schedule', { content, scheduled_for: `${scheduleDate}T${scheduleTime}` });
      setTimeout(() => {
        setScheduling(false);
        alert(`Scheduled post #${idx + 1} for ${scheduleDate} at ${scheduleTime}`);
      }, 800);
    } catch (err) {
      setScheduling(false);
      setScheduleError('Failed to schedule.');
    }
  };

  return (
    <li className="bg-white rounded shadow p-4">
      <div className="font-bold mb-2">Prompt #{idx + 1}</div>
      <div className="mb-2 text-gray-700 whitespace-pre-line">{content}</div>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="date"
          className="border rounded px-2 py-1"
          value={scheduleDate}
          onChange={e => setScheduleDate(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={handleSchedule}
          disabled={scheduling || !scheduleDate}
        >
          {scheduling ? 'Scheduling...' : 'Schedule'}
        </button>
      </div>
      {scheduleError && <div className="text-red-500 text-sm">{scheduleError}</div>}
    </li>
  );
}

export default BulkGeneration;
