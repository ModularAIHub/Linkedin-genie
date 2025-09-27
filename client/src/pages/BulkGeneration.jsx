
import React, { useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import api from '../utils/api';

const frequencyOptions = [
  { value: 'once_daily', label: 'Once a day' },
  { value: 'twice_daily', label: 'Twice a day' },
  { value: 'custom', label: 'Custom days' },
];

function BulkResultItem({ idx, result, onDiscard }) {
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const content = result?.result?.content || result?.content || 'No content generated.';

  const handleSchedule = async () => {
    setScheduling(true);
    setScheduleError('');
    try {
      // TODO: Implement actual scheduling API call
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
    <li className="bg-white rounded shadow p-4 flex flex-col gap-2 relative">
      <button className="absolute top-2 right-2 text-xs text-red-500" onClick={() => onDiscard(idx)} title="Discard">✕</button>
      <div className="font-bold mb-2">Prompt #{idx + 1}</div>
      <div className="mb-2 text-gray-700 whitespace-pre-line">{content}</div>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="date"
          className="border rounded px-2 py-1"
          value={scheduleDate}
          onChange={e => setScheduleDate(e.target.value)}
        />
        <input
          type="time"
          className="border rounded px-2 py-1"
          value={scheduleTime}
          onChange={e => setScheduleTime(e.target.value)}
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

const BulkGeneration = () => {
  const [prompts, setPrompts] = useState('');
  const [results, setResults] = useState([]);
  const [discarded, setDiscarded] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [frequency, setFrequency] = useState('once_daily');

  const handlePromptsChange = (e) => {
    setPrompts(e.target.value);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setResults([]);
    setDiscarded([]);
    try {
      const promptArr = prompts.split('\n').map(p => p.trim()).filter(Boolean);
      const res = await api.post('/api/ai/bulk-generate', { prompts: promptArr });
      setResults(res.data.results || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Bulk generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDiscard = (idx) => {
    setDiscarded(prev => [...prev, idx]);
  };

  const handleScheduleAll = () => {
    setShowScheduleModal(true);
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Bulk AI Content Generation</h1>
      <p className="mb-6 text-gray-600">Enter multiple prompts (one per line). Generate LinkedIn posts in bulk.</p>
      <textarea
        className="w-full px-3 py-2 border rounded mb-4"
        value={prompts}
        onChange={handlePromptsChange}
        placeholder={"Enter each prompt on a new line..."}
        rows={6}
      />
      <div className="flex items-center gap-4 mb-4">
        <button className="btn btn-success" onClick={handleGenerate} disabled={loading || !prompts.trim()}>
          {loading ? <LoadingSpinner size="sm" /> : 'Generate All'}
        </button>
        {results.length > 0 && (
          <button className="btn btn-primary" onClick={handleScheduleAll}>
            Schedule All
          </button>
        )}
        <select
          className="border rounded px-2 py-1"
          value={frequency}
          onChange={e => setFrequency(e.target.value)}
        >
          {frequencyOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      {error && <div className="text-red-500 mb-4">{error}</div>}
      {results.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">Results</h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((result, idx) => (
              discarded.includes(idx) ? null : (
                <BulkResultItem key={idx} idx={idx} result={result} onDiscard={handleDiscard} />
              )
            ))}
          </ul>
        </div>
      )}
      {/* Modal for scheduling all - can be implemented as needed */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-2">Schedule All Posts</h3>
            <p className="mb-4">(Scheduling logic can be implemented here, e.g. frequency, start date, etc.)</p>
            <button className="btn btn-primary" onClick={() => setShowScheduleModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};



export default BulkGeneration;


