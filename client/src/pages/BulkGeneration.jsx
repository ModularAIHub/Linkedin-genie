import React, { useState } from 'react';
import Masonry from 'react-masonry-css';
import Collapsible from '../components/Collapsible';
import SelectionTextEditor from '../components/SelectionTextEditor';
import { ai, scheduling } from '../utils/api';
import dayjs from 'dayjs';
import moment from 'moment-timezone';
import { Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import { hasProPlanAccess } from '../utils/planAccess';
import { getSuiteGenieProUpgradeUrl } from '../utils/upgradeUrl';

const MAX_BULK_PROMPTS = 30;
const MAX_SCHEDULING_WINDOW_DAYS = 15;
const RECOMMENDED_SCHEDULING_WINDOW_DAYS = 14;
const PROMPT_LIMIT_WARNING = `Only the first ${MAX_BULK_PROMPTS} prompts will be used.`;

const BulkGeneration = () => {
  const { user } = useAuth();
  const hasProAccess = hasProPlanAccess(user);
  const upgradeUrl = getSuiteGenieProUpgradeUrl();
  const { selectedAccount } = useAccount();
  const [prompts, setPrompts] = useState('');
  const [promptList, setPromptList] = useState([]);
  const [outputs, setOutputs] = useState({});
  const [discarded, setDiscarded] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [frequency, setFrequency] = useState('daily');
  const [startDate, setStartDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [postsPerDay, setPostsPerDay] = useState(1);
  const [dailyTimes, setDailyTimes] = useState(['09:00']);
  const [daysOfWeek, setDaysOfWeek] = useState([]);
  const [schedulingStatus, setSchedulingStatus] = useState('idle');
  const [imageModal, setImageModal] = useState({ open: false, src: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreditInfo, setShowCreditInfo] = useState(true);

  const frequencyOptions = [
    { value: 'daily', label: 'Daily posting' },
    { value: 'thrice_weekly', label: 'Thrice a week' },
    { value: 'four_times_weekly', label: 'Four times a week' },
    { value: 'custom', label: 'Custom days' },
  ];

  const handlePostsPerDayChange = (count) => {
    setPostsPerDay(count);
    const newTimes = Array(count).fill(null).map((_, i) => 
      dailyTimes[i] || `${String(9 + i * 3).padStart(2, '0')}:00`
    );
    setDailyTimes(newTimes);
  };

  const handleTimeChange = (index, time) => {
    const newTimes = [...dailyTimes];
    newTimes[index] = time;
    setDailyTimes(newTimes);
  };

  const handleDiscard = (idx) => {
    setDiscarded(prev => [...prev, idx]);
  };

  const handleScheduleAll = () => {
    setShowScheduleModal(true);
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSchedule = async () => {
    setSchedulingStatus('scheduling');
    try {
      const toSchedule = Object.keys(outputs)
        .filter(idx => !discarded.includes(Number(idx)))
        .map(idx => outputs[idx]);
      if (toSchedule.length === 0) {
        setSchedulingStatus('error');
        alert('No posts to schedule.');
        return;
      }
      if (toSchedule.length > MAX_BULK_PROMPTS) {
        setSchedulingStatus('error');
        alert(`You can schedule up to ${MAX_BULK_PROMPTS} prompts at a time.`);
        return;
      }
      const timezone = moment.tz.guess();
      let scheduledTimes = [];
      let current = dayjs(startDate);
      if (frequency === 'daily') {
        for (let i = 0; i < toSchedule.length; i++) {
          const dayOffset = Math.floor(i / postsPerDay);
          const timeIndex = i % postsPerDay;
          const [hour, minute] = dailyTimes[timeIndex].split(':').map(Number);
          scheduledTimes.push(current.add(dayOffset, 'day').hour(hour).minute(minute).second(0).format());
        }
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        let week = 0;
        while (scheduledTimes.length < toSchedule.length) {
          for (const d of days) {
            for (let timeIndex = 0; timeIndex < postsPerDay && scheduledTimes.length < toSchedule.length; timeIndex++) {
              const [hour, minute] = dailyTimes[timeIndex].split(':').map(Number);
              scheduledTimes.push(dayjs(startDate).add(week, 'week').day(d).hour(hour).minute(minute).second(0).format());
            }
          }
          week++;
        }
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek) && daysOfWeek.length > 0) {
        let week = 0;
        while (scheduledTimes.length < toSchedule.length) {
          for (const d of daysOfWeek) {
            for (let timeIndex = 0; timeIndex < postsPerDay && scheduledTimes.length < toSchedule.length; timeIndex++) {
              const [hour, minute] = dailyTimes[timeIndex].split(':').map(Number);
              scheduledTimes.push(dayjs(startDate).add(week, 'week').day(d).hour(hour).minute(minute).second(0).format());
            }
          }
          week++;
        }
      } else {
        const [hour, minute] = dailyTimes[0].split(':').map(Number);
        for (let i = 0; i < toSchedule.length; i++) {
          scheduledTimes.push(current.add(i, 'day').hour(hour).minute(minute).second(0).format());
        }
      }

      const maxSchedulingTime = dayjs().add(MAX_SCHEDULING_WINDOW_DAYS, 'day');
      const exceedsWindow = scheduledTimes.some((time) => dayjs(time).isAfter(maxSchedulingTime));
      if (exceedsWindow) {
        setSchedulingStatus('error');
        alert(`Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead. For best results, plan up to ${RECOMMENDED_SCHEDULING_WINDOW_DAYS} days and then revisit strategy.`);
        return;
      }

      const items = [];
      const mediaMap = {};
      
      for (let i = 0; i < toSchedule.length; i++) {
        const item = toSchedule[i];
        let media = [];
        
        if (item.images && item.images[0]) {
          const imgs = item.images[0];
          if (Array.isArray(imgs)) {
            for (const img of imgs) {
              if (img instanceof File) {
                // eslint-disable-next-line no-await-in-loop
                media.push(await fileToBase64(img));
              } else if (typeof img === 'string') {
                media.push(img);
              }
            }
          } else if (imgs instanceof File) {
            // eslint-disable-next-line no-await-in-loop
            media.push(await fileToBase64(imgs));
          } else if (typeof imgs === 'string') {
            media.push(imgs);
          }
        }
        
        items.push({
          text: item.text,
          isThread: false
        });
        
        if (media.length > 0) {
          mediaMap[i] = media;
        }
      }

      const selectedTeamAccountId =
        selectedAccount && (selectedAccount.isTeamAccount || selectedAccount.account_type === 'team')
          ? (selectedAccount.account_id || selectedAccount.id)
          : null;

      const bulkPayload = {
        items,
        frequency,
        startDate,
        postsPerDay,
        dailyTimes,
        daysOfWeek,
        images: mediaMap,
        timezone,
        account_id: selectedTeamAccountId
      };

      try {
        const result = await scheduling.bulk(bulkPayload);
        setSchedulingStatus('success');
        setShowScheduleModal(false);
        alert(`Successfully scheduled ${result.data.scheduled.length} LinkedIn posts.`);
      } catch (err) {
        setSchedulingStatus('error');
        const details = err?.response?.data?.details;
        const errorMsg = err?.response?.data?.error || err.message;
        alert('Failed to schedule.' + (details ? ('\n' + details.join('\n')) : '') + '\n' + errorMsg);
      }
    } catch (err) {
      setSchedulingStatus('error');
      const details = err?.response?.data?.details;
      const errorMsg = err?.response?.data?.error || err.message;
      alert('Failed to schedule.' + (details ? ('\n' + details.join('\n')) : '') + '\n' + errorMsg);
    }
  };

  const handlePromptsChange = (e) => {
    const rawValue = e.target.value.replace(/\r\n/g, '\n');
    const lines = rawValue.split('\n').map((p) => p.trim()).filter(Boolean);
    const cappedLines = lines.slice(0, MAX_BULK_PROMPTS);
    setPrompts(rawValue);
    if (lines.length > MAX_BULK_PROMPTS) {
      setError(PROMPT_LIMIT_WARNING);
    } else {
      setError((prev) => (prev === PROMPT_LIMIT_WARNING ? '' : prev));
    }
    setPromptList(cappedLines.map((prompt, idx) => ({ prompt, id: idx })));
  };

  const updateText = (idx, value) => {
    setOutputs((prev) => {
      const updated = { ...prev };
      if (updated[idx]) {
        updated[idx] = { ...updated[idx], text: value };
      }
      return updated;
    });
  };

  const handleImageUpload = (outputIdx, files) => {
    setOutputs((prev) => {
      const updated = { ...prev };
      if (updated[outputIdx]) {
        const fileArray = Array.from(files).slice(0, 9);
        const newImages = fileArray.length > 0 ? [fileArray] : [null];
        updated[outputIdx] = { ...updated[outputIdx], images: newImages };
      }
      return updated;
    });
  };

  const removeImage = (outputIdx, imageIdx) => {
    setOutputs((prev) => {
      const updated = { ...prev };
      if (updated[outputIdx] && updated[outputIdx].images[0]) {
        const newImagesForPart = [...updated[outputIdx].images[0]];
        newImagesForPart.splice(imageIdx, 1);
        const newImages = newImagesForPart.length > 0 ? [newImagesForPart] : [null];
        updated[outputIdx] = { ...updated[outputIdx], images: newImages };
      }
      return updated;
    });
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setOutputs({});
    try {
      if (promptList.length > MAX_BULK_PROMPTS) {
        setError(`Bulk generation is limited to ${MAX_BULK_PROMPTS} prompts.`);
        return;
      }
      const newOutputs = {};
      for (let idx = 0; idx < promptList.length; idx++) {
        const { prompt } = promptList[idx];
        setOutputs(prev => ({ ...prev, [idx]: { loading: true, prompt } }));
        try {
          const res = await ai.generate({ prompt, isThread: false });
          const data = res.data;
          
          let postText = data.content;
          if (postText.length > 3000) postText = postText.slice(0, 3000);
          
          newOutputs[idx] = {
            prompt,
            text: postText,
            images: [null],
            id: idx,
            loading: false,
            error: null,
            appeared: true,
          };
          setOutputs(prev => ({ ...prev, [idx]: newOutputs[idx] }));
        } catch (err) {
          newOutputs[idx] = { prompt, loading: false, error: err?.response?.data?.error || 'Failed to generate.' };
          setOutputs(prev => ({ ...prev, [idx]: newOutputs[idx] }));
        }
      }
      setPrompts('');
      setPromptList([]);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to generate LinkedIn posts.');
    } finally {
      setLoading(false);
    }
  };

  if (!hasProAccess) {
    return (
      <div className="max-w-5xl mx-auto py-8 px-4 min-h-[70vh] space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <Lock className="h-6 w-6 text-amber-700 mt-0.5" />
            <div>
              <h1 className="text-2xl font-bold text-amber-900">Bulk Generation is a Pro feature</h1>
              <p className="mt-2 text-sm text-amber-800">
                You can access this page on Free, but generating LinkedIn posts in bulk requires Pro.
                Upgrade to unlock up to {MAX_BULK_PROMPTS} prompts per run and bulk scheduling.
              </p>
              <a
                href={upgradeUrl}
                className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Upgrade to Pro
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">What you will unlock</h2>
          <ul className="mt-3 text-sm text-gray-700 space-y-2">
            <li>Generate LinkedIn posts from multiple prompts in one run.</li>
            <li>Schedule generated content in bulk with cadence controls.</li>
            <li>Plan faster with Strategy Builder to Bulk Generation flow.</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 min-h-[80vh]">
      <div className="rounded-xl bg-gradient-to-r from-blue-700 via-blue-500 to-blue-300 p-1 mb-8 shadow-lg">
        <div className="bg-white rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2 md:mb-0 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2h2M12 12v6m0 0l-3-3m3 3l3-3m-6-6V6a2 2 0 012-2h2a2 2 0 012 2v2" /></svg>
            Bulk LinkedIn Post Generation
          </h1>
          {showCreditInfo && (
            <div className="relative bg-blue-50 border border-blue-300 rounded-lg px-5 py-3 flex items-center gap-3 shadow-sm mt-4 md:mt-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" /></svg>
              <span className="text-blue-900 text-sm font-medium">
                <b>How credits are deducted:</b> Each generated LinkedIn post costs <b>1 credit</b>. Images do not cost extra.
              </span>
              <button onClick={() => setShowCreditInfo(false)} className="ml-3 text-blue-400 hover:text-blue-700 text-lg font-bold focus:outline-none">&times;</button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-8 bg-blue-50 rounded-2xl shadow-2xl p-10 border border-blue-100">
        <div className="relative mb-6">
          <textarea
            className="peer w-full border-2 border-blue-200 bg-white rounded-xl p-4 min-h-[180px] text-base focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition shadow-sm placeholder-transparent resize-vertical"
            style={{ fontSize: '1.1rem', transition: 'border 0.2s, box-shadow 0.2s' }}
            value={prompts}
            onChange={handlePromptsChange}
            placeholder="Enter one prompt per line..."
            disabled={loading}
            id="bulk-prompts"
            aria-label="Prompts (one per line)"
          />
          <label htmlFor="bulk-prompts" className="absolute left-4 top-3 text-blue-500 text-base font-medium pointer-events-none transition-all duration-200 peer-focus:-top-5 peer-focus:text-sm peer-focus:text-blue-700 peer-placeholder-shown:top-3 peer-placeholder-shown:text-base peer-placeholder-shown:text-blue-400 bg-blue-50 px-1 rounded">
            Prompts (one per line)
          </label>
          <div className="absolute right-4 bottom-3 text-xs text-blue-400 select-none">
            {Math.min(prompts.split('\n').map((line) => line.trim()).filter(Boolean).length, MAX_BULK_PROMPTS)}/{MAX_BULK_PROMPTS} prompts
          </div>
        </div>
        <div className="text-xs text-blue-500 mb-2">Tip: Paste or type multiple prompts, one per line. Each line will generate a LinkedIn post. You can edit or discard results after generation.</div>
        <div className="text-xs text-blue-600 mb-2">Use <b>Space</b> for normal typing and press <b>Enter</b> for a new prompt line.</div>
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Limit: up to {MAX_BULK_PROMPTS} prompts per run. Recommendation: plan bulk content for up to {RECOMMENDED_SCHEDULING_WINDOW_DAYS} days, then revisit your strategy before generating the next batch.
        </div>
        
        {promptList.length > 0 && (
          <div className="mt-4 space-y-2">
            {promptList.map((p, idx) => (
              <div key={p.id} className="flex items-center justify-between bg-gradient-to-r from-blue-100 to-blue-200 rounded-xl px-4 py-2 border border-blue-200 shadow-sm">
                <span className="text-sm text-gray-700 flex-1 truncate">{p.prompt}</span>
              </div>
            ))}
          </div>
        )}
        
        <button
          className="mt-6 bg-gradient-to-r from-blue-600 to-blue-400 text-white px-10 py-3 text-lg font-semibold rounded-xl shadow-lg hover:from-blue-700 hover:to-blue-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={handleGenerate}
          disabled={loading || !prompts.trim()}
        >
          {loading ? (
            <span className="flex items-center gap-2"><span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></span> Generating...</span>
          ) : 'Generate LinkedIn Posts'}
        </button>
        {error && <div className="mt-4 text-red-600 font-medium">{error}</div>}
      </div>

      {Object.keys(outputs).length > 0 && (
        <>
          {showScheduleModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
              <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full relative max-h-[90vh] overflow-y-auto">
                <button className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl" onClick={() => setShowScheduleModal(false)}>&times;</button>
                <h2 className="text-2xl font-bold mb-4">Schedule Your Generated Content</h2>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Frequency:</label>
                  <select className="border rounded px-3 py-2 w-full" value={frequency} onChange={e => setFrequency(e.target.value)}>
                    {frequencyOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Start Date:</label>
                  <input
                    type="date"
                    className="border rounded px-3 py-2 w-full"
                    value={startDate}
                    min={dayjs().format('YYYY-MM-DD')}
                    max={dayjs().add(MAX_SCHEDULING_WINDOW_DAYS, 'day').format('YYYY-MM-DD')}
                    onChange={e => setStartDate(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-amber-700">
                    Hard limit: {MAX_SCHEDULING_WINDOW_DAYS} days ahead. Best practice: schedule up to {RECOMMENDED_SCHEDULING_WINDOW_DAYS} days, review strategy, then generate next batch.
                  </p>
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Posts per Day:</label>
                  <select className="border rounded px-3 py-2 w-full" value={postsPerDay} onChange={e => handlePostsPerDayChange(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map(num => (
                      <option key={num} value={num}>{num} post{num > 1 ? 's' : ''} per day</option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block font-semibold mb-1">Posting Times:</label>
                  <div className="space-y-2">
                    {dailyTimes.map((time, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 min-w-[60px]">Time {index + 1}:</span>
                        <input 
                          type="time" 
                          className="border rounded px-3 py-2 flex-1" 
                          value={time} 
                          onChange={e => handleTimeChange(index, e.target.value)} 
                        />
                      </div>
                    ))}
                  </div>
                </div>
                {frequency === 'custom' && (
                  <div className="mb-4">
                    <label className="block font-semibold mb-1">Days of Week:</label>
                    <div className="flex gap-2 flex-wrap">
                      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                        <label key={i} className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={daysOfWeek.includes(i)} onChange={e => {
                            setDaysOfWeek(prev => e.target.checked ? [...prev, i] : prev.filter(x => x !== i));
                          }} />
                          <span>{d}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <button className="btn btn-primary px-6 py-2 mt-4" onClick={handleSchedule} disabled={schedulingStatus === 'scheduling'}>
                  {schedulingStatus === 'scheduling' ? 'Scheduling...' : 'Schedule'}
                </button>
              </div>
            </div>
          )}
          
          <>
            <div className="flex items-center mb-4">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden mr-4">
                <div
                  className="h-2 bg-blue-500 transition-all duration-500"
                  style={{ width: `${(Object.values(outputs).filter(o => o.loading === false).length / (Object.keys(outputs).length || 1)) * 100}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600 font-medium">
                {Object.values(outputs).filter(o => o.loading === false).length} of {Object.keys(outputs).length} generated
              </span>
              {loading && <span className="ml-3 animate-spin h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full"></span>}
            </div>
            
            <div className="flex justify-end mb-2">
              <button
                className="btn btn-success px-5 py-2 rounded font-semibold shadow"
                onClick={handleScheduleAll}
                disabled={Object.keys(outputs).length === 0 || Object.keys(outputs).filter(idx => !discarded.includes(Number(idx))).length === 0}
              >
                Schedule All
              </button>
            </div>
            
            <Masonry
              breakpointCols={{ default: 2, 900: 1 }}
              className="flex w-full gap-4 min-h-[60vh]"
              columnClassName="masonry-column"
            >
              {Object.keys(outputs)
                .sort((a, b) => Number(a) - Number(b))
                .filter(idx => !discarded.includes(Number(idx)))
                .map((idx) => {
                  const output = outputs[idx];
                  return (
                    <div key={idx} className={`mb-4 transition-all duration-500 ${output.appeared ? 'animate-fadein' : ''}`}>
                      {output.loading ? (
                        <div className="bg-gray-100 rounded-lg p-6 border flex flex-col items-center justify-center min-h-[120px] animate-pulse">
                          <div className="w-2/3 h-4 bg-gray-300 rounded mb-2"></div>
                          <div className="w-1/2 h-3 bg-gray-200 rounded mb-1"></div>
                          <div className="w-1/3 h-3 bg-gray-200 rounded"></div>
                          <span className="mt-4 text-xs text-gray-400">Generating...</span>
                        </div>
                      ) : output.error ? (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 font-medium">
                          Error: {output.error}
                        </div>
                      ) : (
                        <Collapsible
                          title={
                            <span>
                              <span className="px-3 py-1 rounded-full text-xs font-semibold mr-3 transition-colors bg-blue-100 text-blue-700">
                                LinkedIn Post
                              </span>
                              <span className="text-gray-500 text-xs italic">Prompt: {output.prompt}</span>
                            </span>
                          }
                          defaultOpen={Object.keys(outputs).length <= 3}
                        >
                          <div className="flex flex-col items-start gap-2 p-2 w-full max-w-3xl mx-auto">
                            <SelectionTextEditor
                              value={output.text}
                              onChange={e => updateText(Number(idx), e.target.value)}
                              placeholder="Post content..."
                              className="border rounded px-4 py-5 text-lg min-w-[500px] max-w-full min-h-[260px] max-h-[700px] focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition overflow-auto w-full resize-vertical"
                              style={{ fontSize: '1.18rem', lineHeight: '1.7' }}
                              disabled={loading}
                              rows={Math.max(10, Math.min(30, output.text.split('\n').length))}
                            />
                            <div className="flex flex-col space-y-2 mt-1 w-full">
                              <div className="flex items-center space-x-2">
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={e => handleImageUpload(Number(idx), e.target.files)}
                                  disabled={loading}
                                  className="text-sm"
                                />
                                <span className="text-xs text-gray-500">
                                  {output.images[0] && Array.isArray(output.images[0]) 
                                    ? `${output.images[0].length} image${output.images[0].length > 1 ? 's' : ''}`
                                    : 'No images'}
                                </span>
                              </div>
                              {output.images[0] && Array.isArray(output.images[0]) && (
                                <div className="flex flex-wrap gap-2">
                                  {output.images[0].map((img, imgIdx) => (
                                    <div key={imgIdx} className="relative group">
                                      <img
                                        src={URL.createObjectURL(img)}
                                        alt={`preview ${imgIdx + 1}`}
                                        className="h-20 w-20 object-cover rounded border cursor-pointer hover:opacity-75 transition"
                                        onClick={() => setImageModal({ open: true, src: URL.createObjectURL(img) })}
                                      />
                                      <button
                                        onClick={() => removeImage(Number(idx), imgIdx)}
                                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </Collapsible>
                      )}
                      <div className="flex justify-end mt-2">
                        <button
                          className="btn btn-danger px-3 py-1 rounded text-xs font-semibold"
                          onClick={() => handleDiscard(Number(idx))}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  );
                })}
            </Masonry>
            
            {imageModal.open && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70" onClick={() => setImageModal({ open: false, src: null })}>
                <div className="relative max-w-3xl w-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
                  <img src={imageModal.src} alt="Full preview" className="max-h-[80vh] max-w-full rounded shadow-lg border-4 border-white" />
                  <button className="mt-4 px-6 py-2 bg-white text-black rounded shadow font-semibold" onClick={() => setImageModal({ open: false, src: null })}>Close</button>
                </div>
              </div>
            )}
          </>
        </>
      )}
    </div>
  );
};

export default BulkGeneration;

