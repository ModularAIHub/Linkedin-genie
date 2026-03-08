import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Loader2,
  CheckCircle2,
  Edit2,
  Target,
  TrendingUp,
  MessageCircle,
  Users,
  Sparkles,
  Zap,
  BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { profileAnalysis as analysisApi } from '../../utils/api';
import { useAccount } from '../../contexts/AccountContext';

const GOALS_OPTIONS = [
  { id: 'authority', label: 'Build authority', icon: Target },
  { id: 'followers', label: 'Grow followers', icon: TrendingUp },
  { id: 'engagement', label: 'Drive engagement', icon: MessageCircle },
  { id: 'leads', label: 'Generate leads', icon: Zap },
  { id: 'educate', label: 'Educate audience', icon: BookOpen },
  { id: 'community', label: 'Build community', icon: Users },
];

// Pre-built suggestions based on common niches keyed by keyword match
const NICHE_SUGGESTIONS = [
  'SaaS / Software', 'Indie Hacker / Builder', 'AI / Machine Learning', 'Web Development',
  'DevOps / Cloud', 'Mobile Development', 'Cybersecurity', 'Data Science',
  'Creator Economy', 'Design / UI/UX', 'Marketing / Growth', 'E-commerce',
  'Fintech', 'EdTech', 'Health & Fitness Tech', 'Gaming / Game Dev',
  'Crypto / Web3', 'Open Source', 'Startup Founder', 'Freelance Developer',
];

const AUDIENCE_SUGGESTIONS = [
  'Indie hackers & solopreneurs', 'Software developers', 'Startup founders', 
  'Product managers', 'LinkedIn creator community', 'SaaS users & buyers',
  'Junior developers', 'Senior engineers', 'Non-technical founders',
  'Digital marketers', 'Content creators', 'Freelancers & consultants',
  'DevOps engineers', 'Data engineers', 'Students & learners',
  'Small business owners', 'Growth hackers', 'Designer developers',
];

const TONE_SUGGESTIONS = [
  { label: 'Casual and conversational' },
  { label: 'Professional and informative' },
  { label: 'Witty and humorous' },
  { label: 'Direct and no-nonsense' },
  { label: 'Inspirational and motivating' },
  { label: 'Educational and helpful' },
  { label: 'Build-in-public storytelling' },
  { label: 'Technical and detailed' },
];

const ANALYSIS_STEPS = [
  { key: 'connected', label: 'Connected to your LinkedIn account' },
  { key: 'tweets', label: 'Reading your recent post history' },
  { key: 'analysing', label: 'Extracting niche, audience, and tone signals' },
  { key: 'trending', label: 'Building ideas, topics, and gaps to target' },
];

const mapGoalLabelsToIds = (goalValues = []) => {
  const normalizedSet = new Set(
    (Array.isArray(goalValues) ? goalValues : [])
      .map((value) => String(value || '').toLowerCase().trim())
      .filter(Boolean)
  );
  return GOALS_OPTIONS.filter((goal) => {
    const label = goal.label.toLowerCase();
    return normalizedSet.has(label) || Array.from(normalizedSet).some((value) => label.includes(value) || value.includes(label));
  }).map((goal) => goal.id);
};

const UI_TOPIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'to', 'the',
  'our', 'we', 'you', 'your', 'i', 'me', 'my', 'us',
  'am', 'are', 'be', 'been', 'being', 'was', 'were',
  'hashtag', 'hashtags', 'post', 'posts', 'published', 'edited', 'repost', 'reposted',
  'team', 'now', 'one', 'social', 'platform',
  'competitor', 'competitors', 'profile', 'configured', 'yet',
  'mapped', 'opportunity', 'analysis', 'connected', 'current', 'angle', 'score', 'sharpen', 'gap', 'gaps',
  'build', 'built', 'agency', 'client', 'workflow', 'analytic',
  'add', 'unlock', 'precise', 'analysi', 'analysis'
]);

const normalizeTopicForUi = (rawValue = '') => {
  const value = String(rawValue || '')
    .replace(/\bcontentcreation\b/gi, 'content creation')
    .replace(/\bsocialmediamanagement\b/gi, 'social media management')
    .replace(/\bmarketingtool\b/gi, 'marketing tool')
    .replace(/\bproductupdate\b/gi, 'product update')
    .replace(/\bagencylife\b/gi, 'agency life')
    .replace(/\bbuildinpublic\b/gi, 'build in public')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/^#+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';

  const words = value
    .split(' ')
    .map((word) => {
      if (!word) return '';
      if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`;
      if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) return word.slice(0, -1);
      return word;
    })
    .filter((word) => word && word.length >= 3 && !UI_TOPIC_STOP_WORDS.has(word));

  if (words.length === 0 || words.length > 2) return '';
  const normalized = words.join(' ').trim();
  if (normalized.length > 36) return '';
  return normalized;
};

const splitTopicCandidates = (rawValue = '') => {
  const value = String(rawValue || '').trim();
  if (!value) return [];
  if (value.length <= 40) return [value];

  const bySeparators = value
    .split(/\r?\n|,|;|\||\/|\u2022|\u25CF|\u25E6/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (bySeparators.length > 1) {
    return bySeparators;
  }

  // Reject long unstructured sentence blobs from low quality model output.
  return [];
};

const sanitizeTopicListForUi = (items = [], max = 12) => {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const candidates = splitTopicCandidates(item);
    for (const candidate of candidates) {
      const normalized = normalizeTopicForUi(candidate);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
      if (result.length >= max) break;
    }
    if (result.length >= max) break;
  }
  return result;
};

const sanitizeTrendingTopicsForUi = (items = [], max = 12) => {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const rawTopic = typeof item === 'string' ? item : item?.topic;
    const candidates = splitTopicCandidates(rawTopic);
    for (const candidate of candidates) {
      const topic = normalizeTopicForUi(candidate);
      if (!topic) continue;
      const key = topic.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        topic,
        relevance: String(item?.relevance || '').toLowerCase() === 'high' ? 'high' : 'medium',
        context: typeof item?.context === 'string' ? item.context.slice(0, 120) : '',
      });
      if (result.length >= max) break;
    }
    if (result.length >= max) break;
  }
  return result;
};

const sanitizeGapMapForUi = (items = [], max = 5) => {
  const seen = new Set();
  const result = [];

  for (const item of Array.isArray(items) ? items : []) {
    const topic = normalizeTopicForUi(item?.topic || '');
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rawScore = Number(item?.score ?? item?.gap_score ?? item?.gapScore);
    const score = Number.isFinite(rawScore)
      ? Math.max(5, Math.min(95, Math.round(rawScore)))
      : 50;

    result.push({
      topic,
      score,
      reason: String(item?.reason || '').trim().slice(0, 160),
    });

    if (result.length >= max) break;
  }

  return result;
};

const fallbackTopicsFromContext = (analysis = {}) => {
  const candidates = [
    analysis?.niche,
    analysis?.audience,
    ...(Array.isArray(analysis?.goals) ? analysis.goals : []),
  ];
  const cleaned = sanitizeTopicListForUi(candidates, 8);
  if (cleaned.length > 0) return cleaned;
  return ['linkedin strategy', 'content marketing', 'audience growth'];
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const base64 = raw.includes(',') ? raw.split(',').pop() : raw;
      resolve(base64 || '');
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const getPdfConfidenceMeta = (confidenceRaw = '', extractionSource = 'unknown') => {
  const confidence = String(confidenceRaw || '').toLowerCase().trim();
  if (confidence === 'high') {
    return { label: 'High', dotClass: 'bg-green-500', textClass: 'text-green-700' };
  }
  if (confidence === 'medium') {
    return { label: 'Medium', dotClass: 'bg-amber-500', textClass: 'text-amber-700' };
  }
  if (confidence === 'low') {
    return { label: 'Low', dotClass: 'bg-red-500', textClass: 'text-red-700' };
  }
  if (String(extractionSource || '').toLowerCase() === 'local_fallback') {
    return { label: 'Low (fallback)', dotClass: 'bg-red-500', textClass: 'text-red-700' };
  }
  return { label: 'Unknown', dotClass: 'bg-gray-400', textClass: 'text-gray-600' };
};

const AnalysisFlow = ({ strategyId, onComplete, onCancel }) => {
  const { selectedAccount, getCurrentAccountId } = useAccount();
  const [phase, setPhase] = useState('welcome'); // welcome | loading | confirm | reference | generating | done
  const [analysisId, setAnalysisId] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [trendingTopics, setTrendingTopics] = useState([]);
  const [gapMap, setGapMap] = useState([]);
  const [tweetsAnalysed, setTweetsAnalysed] = useState(0);
  const [confidence, setConfidence] = useState('low');
  const [confidenceReason, setConfidenceReason] = useState('');
  const [loadingSteps, setLoadingSteps] = useState({});
  const [confirmStep, setConfirmStep] = useState(0);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [selectedGoals, setSelectedGoals] = useState([]);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [referenceHandles, setReferenceHandles] = useState(['', '']);
  const [referenceResults, setReferenceResults] = useState([]);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [userContext, setUserContext] = useState('');
  const [deeperUrl, setDeeperUrl] = useState('');
  const [deeperContext, setDeeperContext] = useState('');
  const [isUploadingLinkedinPdf, setIsUploadingLinkedinPdf] = useState(false);
  const [linkedinPdfFilename, setLinkedinPdfFilename] = useState('');
  const [linkedinPdfDiscoveries, setLinkedinPdfDiscoveries] = useState(null);
  const [linkedinPdfError, setLinkedinPdfError] = useState('');
  const [linkedinPdfWarning, setLinkedinPdfWarning] = useState('');
  const scrollRef = useRef(null);
  const linkedinPdfInputRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [confirmStep, phase]);
  const pdfConfidenceMeta = linkedinPdfDiscoveries
    ? getPdfConfidenceMeta(linkedinPdfDiscoveries.confidence, linkedinPdfDiscoveries.extractionSource)
    : null;

  // Welcome screen
  if (phase === 'welcome') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Welcome to Strategy Builder</h2>
          <p className="text-gray-600 mb-8">
            I'll analyse your LinkedIn account and build your personalised content strategy.
          </p>
          
          <div className="space-y-3 mt-6 mb-6 text-left">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Your website or portfolio link
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <input
                type="url"
                placeholder="https://yoursite.com"
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Helps us understand your product before building your strategy</p>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700">
                Anything else you want us to know?
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <textarea
                placeholder="Your target customer, what makes you different, anything relevant..."
                value={userContext}
                onChange={(e) => setUserContext(e.target.value.slice(0, 300))}
                rows={2}
                className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">{userContext.length}/300</p>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">
                LinkedIn profile PDF
                <span className="text-gray-400 font-normal ml-1">(optional fallback)</span>
              </label>
              <p className="text-xs text-gray-400 mt-1">
                If LinkedIn API blocks profile fields, upload your LinkedIn profile PDF export and we will extract about, skills, and experience.
              </p>
              <input
                ref={linkedinPdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleLinkedinPdfFileChange}
                className="mt-2 w-full text-sm text-gray-700 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-gray-700 hover:file:bg-gray-50"
              />
              {isUploadingLinkedinPdf && (
                <p className="text-xs text-blue-600 mt-2 inline-flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Processing PDF...
                </p>
              )}
              {linkedinPdfError && (
                <p className="text-xs text-red-600 mt-2">{linkedinPdfError}</p>
              )}
              {linkedinPdfWarning && !linkedinPdfError && (
                <p className="text-xs text-amber-700 mt-2">{linkedinPdfWarning}</p>
              )}
              {linkedinPdfDiscoveries && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-left">
                  <p className="text-xs font-semibold text-green-800 mb-1 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Extraction complete
                  </p>
                  <p className="text-xs text-green-700">
                    File: {linkedinPdfFilename || 'uploaded.pdf'}
                  </p>
                  <p className="text-xs text-green-700">
                    About: {linkedinPdfDiscoveries.about ? 'found' : 'not found'} | Skills: {linkedinPdfDiscoveries.skills?.length || 0} | Experience: {linkedinPdfDiscoveries.experience ? 'found' : 'not found'}
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <span className={`text-xs font-medium inline-flex items-center gap-1 ${pdfConfidenceMeta?.textClass || 'text-gray-600'}`}>
                      <span className={`w-2 h-2 rounded-full ${pdfConfidenceMeta?.dotClass || 'bg-gray-400'}`} />
                      Confidence: {pdfConfidenceMeta?.label || 'Unknown'}
                    </span>
                    <span className="text-xs text-green-700">
                      Source: {linkedinPdfDiscoveries.extractionSource || 'unknown'}
                    </span>
                  </div>
                  {linkedinPdfDiscoveries.about && (
                    <p className="text-xs text-green-700 mt-1">
                      About preview: {linkedinPdfDiscoveries.about.slice(0, 140)}{linkedinPdfDiscoveries.about.length > 140 ? '...' : ''}
                    </p>
                  )}
                  {(linkedinPdfDiscoveries.skills || []).length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-green-700 mb-1">Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {linkedinPdfDiscoveries.skills.slice(0, 10).map((skill) => (
                          <span
                            key={skill}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-green-200 text-green-800"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {linkedinPdfDiscoveries.experience && (
                    <p className="text-xs text-green-700 mt-1">
                      Experience preview: {linkedinPdfDiscoveries.experience.slice(0, 140)}{linkedinPdfDiscoveries.experience.length > 140 ? '...' : ''}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setLinkedinPdfDiscoveries(null);
                      setLinkedinPdfFilename('');
                      setLinkedinPdfError('');
                      setLinkedinPdfWarning('');
                      if (linkedinPdfInputRef.current) {
                        linkedinPdfInputRef.current.value = '';
                      }
                    }}
                    className="mt-2 text-xs text-green-800 underline"
                  >
                    Remove uploaded PDF
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex justify-center">
            <button
              onClick={() => startAnalysis()}
              disabled={isUploadingLinkedinPdf}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isUploadingLinkedinPdf ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing PDF...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Analyse my account
                </>
              )}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-4">Uses 5 credits for analysis + 10 for prompt generation</p>
        </div>
      </div>
    );
  }

  // Loading screen
  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Analysing your account...</h2>
          
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-900 mb-2">Sources included in this run</p>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>- LinkedIn posts and profile signals</li>
              {linkedinPdfDiscoveries && <li>- Uploaded LinkedIn profile PDF discoveries</li>}
              {portfolioUrl && <li>- Portfolio or website context</li>}
              {userContext && <li>- Additional context you entered</li>}
            </ul>
          </div>

          {/* Show analysis summary once signal extraction completes */}
          {loadingSteps.analysing === 'done' && analysisData && (
            <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm font-medium text-purple-900 mb-3">Analysis complete</p>
              <div className="space-y-2 text-sm text-purple-800">
                <div className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Niche:</span>
                  <span className="flex-1">{analysisData.niche}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Audience:</span>
                  <span className="flex-1">{analysisData.audience}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Topics:</span>
                  <span className="flex-1">{(analysisData.top_topics || []).slice(0, 3).join(', ')}{(analysisData.top_topics || []).length > 3 ? ` +${(analysisData.top_topics || []).length - 3} more` : ''}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-semibold min-w-[80px]">Confidence:</span>
                  <span className="flex-1 capitalize">{confidence}</span>
                </div>
                {confidenceReason && (
                  <div className="flex items-start gap-2">
                    <span className="font-semibold min-w-[80px]">Reason:</span>
                    <span className="flex-1">{confidenceReason}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          <div className="space-y-4">
            {ANALYSIS_STEPS.map((step) => {
              const status = loadingSteps[step.key];
              return (
                <div key={step.key} className="flex items-center gap-3">
                  {status === 'done' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  ) : status === 'loading' ? (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0" />
                  )}
                  <span className={`text-sm ${status === 'done' ? 'text-gray-900 font-medium' : status === 'loading' ? 'text-blue-700' : 'text-gray-400'}`}>
                    {step.label}
                    {step.key === 'tweets' && tweetsAnalysed > 0 ? ` (${tweetsAnalysed} posts found)` : ''}
                  </span>
                </div>
              );
            })}
          </div>
          {error && (
            <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
              <button onClick={() => startAnalysis()} className="block mt-2 text-red-600 underline font-medium">
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Generating prompts screen
  if (phase === 'generating') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Generating your prompt library...</h2>
          <p className="text-gray-600 text-sm mb-4">Creating your LinkedIn prompt pack from approved strategy signals.</p>
        </div>
      </div>
    );
  }

  // Done screen
  if (phase === 'done') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Strategy ready!</h2>
          <p className="text-gray-600 mb-2">Prompt pack generated and saved.</p>
          <p className="text-sm text-gray-500 mb-6">Your Overview tab shows the full summary. Prompts tab is ready to use.</p>
          <button
            onClick={() => onComplete?.()}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            View my strategy
          </button>
        </div>
      </div>
    );
  }

  // Confirmation flow
  const confirmSteps = [
    {
      key: 'niche',
      title: 'Your niche',
      description: portfolioUrl || userContext || linkedinPdfDiscoveries
        ? 'Based on your LinkedIn activity, portfolio, and context:'
        : 'Based on your LinkedIn activity, your niche looks like:',
      value: analysisData?.niche || '',
      badge: `Based on ${tweetsAnalysed} posts analysed${portfolioUrl ? ' + portfolio' : ''}${linkedinPdfDiscoveries ? ' + LinkedIn profile PDF' : ''}${userContext ? ' + your context' : ''}`,
    },
    {
      key: 'audience',
      title: 'Your audience',
      description: 'Your content seems targeted at:',
      value: analysisData?.audience || '',
    },
    {
      key: 'tone',
      title: 'Your writing style',
      description: 'Your writing style comes across as:',
      value: analysisData?.tone || '',
    },
    {
      key: 'goals',
      title: 'Your goals',
      description: 'What do you want to achieve on LinkedIn?',
      type: 'goals',
    },
    {
      key: 'topics',
      title: 'Your topics',
      description: 'Based on your posts, you publish most about:',
      type: 'topics',
    },
    {
      key: 'posting_frequency',
      title: 'Posting schedule',
      description: tweetsAnalysed > 5
        ? 'Based on your posting history:'
        : 'We do not have enough post history yet - pick a schedule that works for you:',
      type: 'posting_schedule',
      value: `${analysisData?.posting_frequency || '3-5 times per week'}\nBest on ${(analysisData?.best_days || ['Tuesday', 'Thursday']).join(' and ')} (${analysisData?.best_hours || '9am-11am'})`,
    },
  ];

  const currentConfirmStep = confirmSteps[confirmStep] || null;
  const cleanedTopTopics = sanitizeTopicListForUi(analysisData?.top_topics || [], 12);
  const selectedTopicKeys = new Set(
    cleanedTopTopics.map((topic) => String(topic || '').trim().toLowerCase()).filter(Boolean)
  );
  const availableTrendingTopics = (() => {
    const seen = new Set();
    const result = [];
    for (const trend of Array.isArray(trendingTopics) ? trendingTopics : []) {
      const normalized = normalizeTopicForUi(trend?.topic || '');
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (selectedTopicKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      result.push({ ...trend, topic: normalized });
      if (result.length >= 12) break;
    }
    return result;
  })();

  // Reference accounts phase
  if (phase === 'reference') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-2">Want to go deeper?</h3>
          <p className="text-gray-600 text-sm mb-6">
            Add up to 2 LinkedIn profiles you want to learn from - competitors or creators in your niche you respect.
          </p>
          <div className="space-y-3 mb-6">
            {referenceHandles.map((handle, idx) => (
              <input
                key={idx}
                type="text"
                placeholder={`linkedin.com/in/handle (optional)`}
                value={handle}
                onChange={(e) => {
                  const next = [...referenceHandles];
                  let val = e.target.value.trim();
                  // Extract username from URLs like linkedin.com/in/handle or x.com/handle
                  const urlMatch = val.match(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/|x\.com\/|twitter\.com\/)?(?:@)?([a-zA-Z0-9._-]+)/i);
                  if (urlMatch) {
                    val = urlMatch[1];
                  } else {
                    val = val.replace(/[^a-zA-Z0-9_@]/g, '');
                  }
                  next[idx] = val;
                  setReferenceHandles(next);
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            ))}
          </div>

          <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Additional context (optional)</p>
            <input
              type="url"
              placeholder="Any other website to include in analysis..."
              value={deeperUrl}
              onChange={(e) => setDeeperUrl(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="Anything else to consider when deepening your strategy..."
              value={deeperContext}
              onChange={(e) => setDeeperContext(e.target.value.slice(0, 300))}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <p className="text-xs text-gray-400">{deeperContext.length}/300</p>
          </div>

          {referenceResults.length > 0 && (
            <div className="space-y-4 mb-6">
              {referenceResults.map((ref, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-gray-900">{ref.handle}</span>
                    {ref.followers && <span className="text-xs text-gray-500">{ref.followers.toLocaleString()} followers</span>}
                  </div>
                  {ref.error ? (
                    <p className="text-sm text-red-600">{ref.error}</p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-700 mb-2">{ref.key_takeaway}</p>
                      {ref.content_angles?.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-gray-500 mb-1">Content angles</p>
                          <div className="flex flex-wrap gap-1">
                            {ref.content_angles.map((angle, i) => (
                              <span key={i} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full">{angle}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {ref.what_works?.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-gray-500 mb-1">What works for them</p>
                          <div className="flex flex-wrap gap-1">
                            {ref.what_works.map((w, i) => (
                              <span key={i} className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">{w}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {ref.gaps_you_can_fill?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">Gaps you can fill</p>
                          <div className="flex flex-wrap gap-1">
                            {ref.gaps_you_can_fill.map((g, i) => (
                              <span key={i} className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded-full">{g}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            {referenceHandles.some((h) => h.trim()) && referenceResults.length === 0 && (
              <button
                onClick={handleAnalyseReferences}
                disabled={isAnalysing}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isAnalysing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Analysing...</>
                ) : (
                  <><Search className="w-4 h-4" /> Analyse these accounts</>
                )}
              </button>
            )}
            <button
              onClick={handleGeneratePrompts}
              disabled={isGenerating}
              className={`flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold transition-colors ${
                referenceResults.length > 0 || !referenceHandles.some((h) => h.trim())
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {isGenerating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Starting generation...</>
              ) : (
                <>
                  {referenceResults.length > 0 || !referenceHandles.some((h) => h.trim())
                    ? 'Generate my content'
                    : 'Skip and generate my content'}
                </>
              )}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
      </div>
    );
  }

  // Confirmation steps
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center gap-2">
        {confirmSteps.map((_, idx) => (
          <div
            key={idx}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              idx < confirmStep ? 'bg-green-500' : idx === confirmStep ? 'bg-blue-500' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Completed steps summary */}
      {confirmStep > 0 && (
        <div className="space-y-2">
          {confirmSteps.slice(0, confirmStep).map((step, idx) => (
            <div key={step.key} className="flex items-center gap-3 bg-green-50 rounded-lg px-4 py-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-sm text-green-800 font-medium">{step.title}:</span>
              <span className="text-sm text-green-700 truncate">
                {step.type === 'goals'
                  ? selectedGoals.map((g) => GOALS_OPTIONS.find((o) => o.id === g)?.label).filter(Boolean).join(', ')
                  : step.type === 'topics'
                  ? (analysisData?.top_topics || []).join(', ')
                  : step.value?.split('\n')[0]}
              </span>
            </div>
          ))}
        </div>
      )}

      {gapMap.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-lg font-bold text-gray-900">Opportunities to win</h3>
            <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              {referenceResults.length > 0 ? 'Refined with references' : 'Auto generated'}
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Pick the angles you want in your strategy. Click any card to add it to selected topics.
          </p>
          <div className="space-y-3">
            {gapMap.map((item) => {
              const isSelected = selectedTopicKeys.has(String(item.topic || '').toLowerCase());
              return (
                <button
                  key={item.topic}
                  type="button"
                  disabled={isSelected}
                  onClick={() => {
                    if (isSelected) return;
                    setAnalysisData((prev) => ({
                      ...prev,
                      top_topics: sanitizeTopicListForUi(
                        [...(prev?.top_topics || []), item.topic],
                        12
                      ),
                    }));
                  }}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    isSelected
                      ? 'bg-green-50 border-green-200 cursor-not-allowed'
                      : 'bg-gray-50 border-gray-200 hover:bg-indigo-50 hover:border-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {item.topic}
                    </span>
                    <div className="flex items-center gap-2">
                      {isSelected && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                          Selected
                        </span>
                      )}
                      <span className="text-xs font-medium text-indigo-700">
                        Gap {item.score}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-gray-200 mb-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                      style={{ width: `${item.score}%` }}
                    />
                  </div>
                  {item.reason && (
                    <p className="text-xs text-gray-600">{item.reason}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Current step */}
      {currentConfirmStep && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <p className="text-sm text-gray-500 mb-1">Step {confirmStep + 1} of {confirmSteps.length}</p>
          <h3 className="text-lg font-bold text-gray-900 mb-1">{currentConfirmStep.title}</h3>
          <p className="text-gray-600 text-sm mb-4">{currentConfirmStep.description}</p>

          {/* Goals step - multi select */}
          {currentConfirmStep.type === 'goals' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {GOALS_OPTIONS.map((goal) => (
                <button
                  key={goal.id}
                  onClick={() => {
                    setSelectedGoals((prev) =>
                      prev.includes(goal.id) ? prev.filter((g) => g !== goal.id) : [...prev, goal.id]
                    );
                  }}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    selectedGoals.includes(goal.id)
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <goal.icon className="w-4 h-4 text-blue-700" />
                  <p className="text-sm font-medium text-gray-900 mt-1">{goal.label}</p>
                </button>
              ))}
            </div>
          )}

          {/* Topics step - with trending */}
          {currentConfirmStep.type === 'topics' && (
            <div className="space-y-4 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Your core topics (click to remove):</p>
                <div className="flex flex-wrap gap-2">
                  {cleanedTopTopics.map((topic) => {
                    const isExcluded = selectedTopics.includes(topic);
                    return (
                      <button
                        type="button"
                        key={topic}
                        onClick={() => {
                          setSelectedTopics((prev) =>
                            prev.includes(topic)
                              ? prev.filter((t) => t !== topic)
                              : [...prev, topic]
                          );
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                          isExcluded
                            ? 'bg-gray-100 text-gray-400 line-through border-gray-200'
                            : 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200'
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                  {cleanedTopTopics.length === 0 && (
                    <p className="text-sm text-gray-500">
                      No high-signal topics found yet. Add a custom topic below.
                    </p>
                  )}
                </div>
              </div>

              {availableTrendingTopics.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Trending topics you can add:</p>
                  <div className="flex flex-wrap gap-2">
                    {availableTrendingTopics.map((trend) => {
                      const isAdded = selectedTopicKeys.has(String(trend.topic || '').toLowerCase());
                      return (
                        <button
                          type="button"
                          key={trend.topic}
                          onClick={() => {
                            if (isAdded) return;
                            setAnalysisData((prev) => ({
                              ...prev,
                              top_topics: sanitizeTopicListForUi(
                                [...(prev?.top_topics || []), trend.topic],
                                12
                              ),
                            }));
                          }}
                          disabled={isAdded}
                          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                            isAdded
                              ? 'bg-green-50 border-green-200 text-green-700'
                              : 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
                          }`}
                        >
                          {isAdded ? 'Added' : '+'} {trend.topic}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a custom topic..."
                  value={customTopicInput}
                  onChange={(e) => setCustomTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customTopicInput.trim()) {
                      const newTopic = normalizeTopicForUi(customTopicInput);
                      if (newTopic) {
                        setAnalysisData((prev) => ({
                          ...prev,
                          top_topics: sanitizeTopicListForUi(
                            [...(prev?.top_topics || []), newTopic],
                            12
                          ),
                        }));
                      }
                      setCustomTopicInput('');
                    }
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    if (customTopicInput.trim()) {
                      const newTopic = normalizeTopicForUi(customTopicInput);
                      if (newTopic) {
                        setAnalysisData((prev) => ({
                          ...prev,
                          top_topics: sanitizeTopicListForUi(
                            [...(prev?.top_topics || []), newTopic],
                            12
                          ),
                        }));
                      }
                      setCustomTopicInput('');
                    }
                  }}
                  className="px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-700 hover:bg-gray-200"
                >
                  Add
                </button>
              </div>
            </div>
          )}
          {/* Posting schedule step - presets + custom edit */}
          {currentConfirmStep.type === 'posting_schedule' && (
            <div className="space-y-4 mb-4">
              {/* Current value display */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-blue-900 font-medium whitespace-pre-line">
                  {currentConfirmStep.value}
                </p>
                {tweetsAnalysed > 5 && (
                  <p className="text-xs text-blue-600 mt-2">Based on your {tweetsAnalysed} posts</p>
                )}
              </div>

              {/* Preset options */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Quick presets:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: '1-2 times per week', days: 'Tuesday and Thursday', hours: '10am-12pm', desc: 'Low effort, consistent' },
                    { label: '3-5 times per week', days: 'Tuesday and Thursday', hours: '9am-11am', desc: 'Balanced growth' },
                    { label: 'Daily', days: 'Every day', hours: '9am-10am', desc: 'Maximum reach' },
                    { label: '2x daily', days: 'Every day', hours: '9am & 6pm', desc: 'Aggressive growth' },
                  ].map((preset) => {
                    const presetValue = `${preset.label}\nBest on ${preset.days} (${preset.hours})`;
                    const isSelected = currentConfirmStep.value === presetValue;
                    return (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setAnalysisData((prev) => ({
                            ...prev,
                            posting_frequency: preset.label,
                            best_days: preset.days.split(' and ').map(d => d.replace('Every day', 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday').split(',')).flat().map(d => d.trim()),
                            best_hours: preset.hours,
                          }));
                        }}
                        className={`text-left p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                            : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-900">{preset.label}</p>
                        <p className="text-xs text-gray-500">{preset.desc} - {preset.days} ({preset.hours})</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom edit */}
              {editing === 'posting_frequency' ? (
                <div className="space-y-3">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={3}
                    placeholder="e.g. 3-5 times per week&#10;Best on Tuesday and Thursday (9am-11am)"
                    className="w-full px-4 py-3 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmEdit('posting_frequency', editValue)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditing('posting_frequency');
                    setEditValue(currentConfirmStep.value || '');
                  }}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Write your own schedule
                </button>
              )}
            </div>
          )}

          {/* Text-based steps (niche, audience, tone) */}
          {!currentConfirmStep.type && (
            <div className="mb-4">
              {editing === currentConfirmStep.key ? (
                <div className="space-y-3">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoFocus
                  />

                  {/* Niche suggestions */}
                  {currentConfirmStep.key === 'niche' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Or pick one:</p>
                      <div className="flex flex-wrap gap-2">
                        {NICHE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.niche || '').toLowerCase())
                          .slice(0, 12)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => setEditValue(s)}
                              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                                editValue === s
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Audience suggestions */}
                  {currentConfirmStep.key === 'audience' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Or pick one:</p>
                      <div className="flex flex-wrap gap-2">
                        {AUDIENCE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.audience || '').toLowerCase())
                          .slice(0, 12)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => setEditValue(s)}
                              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                                editValue === s
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Tone suggestions */}
                  {currentConfirmStep.key === 'tone' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Or pick a style:</p>
                      <div className="flex flex-wrap gap-2">
                        {TONE_SUGGESTIONS.map((s) => (
                          <button
                            key={s.label}
                            onClick={() => setEditValue(s.label)}
                            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                              editValue === s.label
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                          >{s.label}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmEdit(currentConfirmStep.key, editValue)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-blue-900 font-medium whitespace-pre-line">
                      {currentConfirmStep.value}
                    </p>
                    {currentConfirmStep.badge && (
                      <p className="text-xs text-blue-600 mt-2">{currentConfirmStep.badge}</p>
                    )}
                  </div>

                  {/* Quick alternatives for niche */}
                  {currentConfirmStep.key === 'niche' && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-2">Not quite right? Pick a closer match:</p>
                      <div className="flex flex-wrap gap-2">
                        {NICHE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.niche || '').toLowerCase())
                          .slice(0, 8)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                setAnalysisData((prev) => ({ ...prev, niche: s }));
                                handleQuickConfirm('niche', s);
                              }}
                              className="px-3 py-1.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Quick alternatives for audience */}
                  {currentConfirmStep.key === 'audience' && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-2">Not quite right? Pick a closer match:</p>
                      <div className="flex flex-wrap gap-2">
                        {AUDIENCE_SUGGESTIONS
                          .filter((s) => s.toLowerCase() !== (analysisData?.audience || '').toLowerCase())
                          .slice(0, 8)
                          .map((s) => (
                            <button
                              key={s}
                              onClick={() => {
                                setAnalysisData((prev) => ({ ...prev, audience: s }));
                                handleQuickConfirm('audience', s);
                              }}
                              className="px-3 py-1.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Quick alternatives for tone */}
                  {currentConfirmStep.key === 'tone' && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-2">Or switch to:</p>
                      <div className="flex flex-wrap gap-2">
                        {TONE_SUGGESTIONS
                          .filter((s) => s.label.toLowerCase() !== (analysisData?.tone || '').toLowerCase())
                          .map((s) => (
                            <button
                              key={s.label}
                              onClick={() => {
                                setAnalysisData((prev) => ({ ...prev, tone: s.label }));
                                handleQuickConfirm('tone', s.label);
                              }}
                              className="px-3 py-1.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                            >{s.label}</button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {editing !== currentConfirmStep?.key && editing !== 'posting_frequency' && (
            <div className="flex gap-3">
              {currentConfirmStep.type === 'goals' ? (
                <button
                  onClick={() => handleConfirmGoals()}
                  disabled={selectedGoals.length === 0}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Confirm ({selectedGoals.length} selected)
                </button>
              ) : currentConfirmStep.type === 'topics' ? (
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => handleConfirmTopics()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Save topics and continue
                  </button>
                  <button
                    onClick={() => setSelectedTopics([])}
                    className="px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              ) : currentConfirmStep.type === 'posting_schedule' ? (
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => handleConfirmStep()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Yes that's right
                  </button>
                </div>
              ) : (
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => handleConfirmStep()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Yes that's right
                  </button>
                  <button
                    onClick={() => {
                      setEditing(currentConfirmStep.key);
                      setEditValue(currentConfirmStep.value || '');
                    }}
                    className="px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          )}
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
      )}

      <div ref={scrollRef} />
    </div>
  );

  // Handler functions
  async function startAnalysis() {
    setPhase('loading');
    setError(null);
    setLoadingSteps({ connected: 'done', tweets: 'loading' });
    setGapMap([]);

    try {
      const selectedAccountId = getCurrentAccountId();
      const selectedAccountType =
        selectedAccountId && selectedAccount?.isTeamAccount
          ? 'team'
          : (
              selectedAccountId && selectedAccount?.account_type
                ? selectedAccount.account_type
                : null
            );
      console.log('[AnalysisFlow] Starting analysis', {
        strategyId,
        selectedAccountId,
        selectedAccountType,
        hasPortfolioUrl: Boolean(String(portfolioUrl || '').trim()),
        hasUserContext: Boolean(String(userContext || '').trim()),
        hasLinkedinPdfDiscoveries: Boolean(linkedinPdfDiscoveries),
      });

      // Start the API call
      const apiPromise = analysisApi.analyse(strategyId, {
        portfolioUrl,
        userContext,
        ...(selectedAccountId ? { account_id: selectedAccountId } : {}),
        ...(selectedAccountType ? { account_type: selectedAccountType } : {}),
      });

      // Animate completion steps while API is running
      setLoadingSteps({ connected: 'done', tweets: 'loading' });
      await delay(500);
      
      setLoadingSteps({ connected: 'done', tweets: 'done', analysing: 'loading' });
      await delay(350);
      
      // Wait for API to complete
      const response = await apiPromise;
      const data = response.data;
      console.log('[AnalysisFlow] Analysis response', {
        analysisId: data?.analysisId,
        tweetsAnalysed: data?.tweetsAnalysed || 0,
        confidence: data?.confidence || 'unknown',
        trendingCount: Array.isArray(data?.trending) ? data.trending.length : 0,
      });

      const cleanedAnalysis = {
        ...(data.analysis || {}),
        top_topics: sanitizeTopicListForUi(data?.analysis?.top_topics || [], 12),
      };
      if ((cleanedAnalysis.top_topics || []).length === 0) {
        cleanedAnalysis.top_topics = fallbackTopicsFromContext(cleanedAnalysis);
      }
      const preselectedGoalIds = mapGoalLabelsToIds(cleanedAnalysis?.goals || cleanedAnalysis?.content_goals || []);
      setTweetsAnalysed(data.tweetsAnalysed || 0);
      setAnalysisData(cleanedAnalysis);
      setTrendingTopics(sanitizeTrendingTopicsForUi(data.trending || [], 12));
      setGapMap(sanitizeGapMapForUi(data.gapMap || [], 5));
      setConfidence(data.confidence || 'low');
      setConfidenceReason(data.confidenceReason || '');
      setSelectedGoals(preselectedGoalIds.length > 0 ? preselectedGoalIds : ['followers']);
      
      setLoadingSteps({ connected: 'done', tweets: 'done', analysing: 'done', trending: 'loading' });
      
      await delay(900);
      
      setLoadingSteps({ connected: 'done', tweets: 'done', analysing: 'done', trending: 'done' });

      setAnalysisId(data.analysisId);

      // Pre-select all topics
      setSelectedTopics([]);

      await delay(500);
      setPhase('confirm');
      setConfirmStep(0);
    } catch (err) {
      console.error('[AnalysisFlow] Analysis failed:', err);
      setError(err.response?.data?.error || err.message || 'Analysis failed. Please try again.');
      setLoadingSteps((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[key] === 'loading') next[key] = undefined;
        }
        return next;
      });
    }
  }

  async function handleConfirmStep() {
    const step = confirmSteps[confirmStep];
    if (!step || !analysisId) return;

    try {
      setError(null);
      const result = await analysisApi.confirmStep(analysisId, step.key, step.value);
      if (Array.isArray(result?.data?.gapMap)) {
        setGapMap(sanitizeGapMapForUi(result.data.gapMap, 5));
      }
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save. Please try again.');
    }
  }

  async function handleLinkedinPdfFileChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    setLinkedinPdfError('');
    setLinkedinPdfWarning('');
    if (file.size > 8 * 1024 * 1024) {
      setLinkedinPdfError('PDF too large. Please upload a file under 8MB.');
      event.target.value = '';
      return;
    }
    const lowerName = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    if (!lowerName.endsWith('.pdf') && type && !type.includes('pdf')) {
      setLinkedinPdfError('Only PDF files are supported.');
      event.target.value = '';
      return;
    }

    setIsUploadingLinkedinPdf(true);
    try {
      const base64 = await fileToBase64(file);
      const response = await analysisApi.uploadLinkedinProfilePdf(strategyId, {
        base64,
        filename: file.name || 'linkedin-profile.pdf',
        mimetype: file.type || 'application/pdf',
      });
      const warning = String(response?.data?.warning || '').trim();
      const discoveries = response?.data?.discoveries || {};
      setLinkedinPdfFilename(discoveries.filename || file.name || 'linkedin-profile.pdf');
      setLinkedinPdfDiscoveries({
        about: String(discoveries.about || '').trim(),
        skills: Array.isArray(discoveries.skills) ? discoveries.skills : [],
        experience: String(discoveries.experience || '').trim(),
        confidence: String(discoveries.confidence || '').trim(),
        notes: String(discoveries.notes || '').trim(),
        textLength: Number(discoveries.textLength || 0),
        extractionSource: String(discoveries.extractionSource || '').trim() || 'unknown',
      });
      setLinkedinPdfWarning(warning);
      console.log('[AnalysisFlow] LinkedIn profile PDF uploaded', {
        strategyId,
        filename: discoveries.filename || file.name || null,
        hasAbout: Boolean(String(discoveries.about || '').trim()),
        skillsCount: Array.isArray(discoveries.skills) ? discoveries.skills.length : 0,
        hasExperience: Boolean(String(discoveries.experience || '').trim()),
        warning: warning || null,
      });
    } catch (err) {
      setLinkedinPdfDiscoveries(null);
      setLinkedinPdfFilename('');
      setLinkedinPdfError(err?.response?.data?.error || err?.message || 'Failed to process uploaded PDF.');
      setLinkedinPdfWarning('');
    } finally {
      setIsUploadingLinkedinPdf(false);
      event.target.value = '';
    }
  }

  async function handleQuickConfirm(key, value) {
    if (!analysisId) return;
    try {
      setError(null);
      const result = await analysisApi.confirmStep(analysisId, key, value);
      if (Array.isArray(result?.data?.gapMap)) {
        setGapMap(sanitizeGapMapForUi(result.data.gapMap, 5));
      }
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save.');
    }
  }

  async function handleConfirmEdit(key, value) {
    if (!analysisId) return;
    try {
      setError(null);
      const result = await analysisApi.confirmStep(analysisId, key, value);
      const nextAnalysis = result.data?.analysisData || analysisData;
      setAnalysisData({
        ...nextAnalysis,
        top_topics: sanitizeTopicListForUi(nextAnalysis?.top_topics || [], 12),
      });
      if (Array.isArray(result?.data?.gapMap)) {
        setGapMap(sanitizeGapMapForUi(result.data.gapMap, 5));
      }
      setEditing(null);
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save.');
    }
  }

  async function handleConfirmGoals() {
    if (!analysisId || selectedGoals.length === 0) return;
    try {
      setError(null);
      const goalLabels = selectedGoals.map((id) => GOALS_OPTIONS.find((o) => o.id === id)?.label).filter(Boolean);
      const result = await analysisApi.confirmStep(analysisId, 'goals', goalLabels);
      if (Array.isArray(result?.data?.gapMap)) {
        setGapMap(sanitizeGapMapForUi(result.data.gapMap, 5));
      }
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save goals.');
    }
  }

  async function handleConfirmTopics() {
    if (!analysisId) return;
    try {
      setError(null);
      const currentTopics = sanitizeTopicListForUi(analysisData?.top_topics || [], 12);
      const selectedDropSet = new Set(
        selectedTopics.map((topic) => String(topic || '').trim().toLowerCase()).filter(Boolean)
      );
      const topics = currentTopics.filter((topic) => !selectedDropSet.has(topic.toLowerCase()));
      const result = await analysisApi.confirmStep(analysisId, 'topics', topics);
      if (Array.isArray(result?.data?.gapMap)) {
        setGapMap(sanitizeGapMapForUi(result.data.gapMap, 5));
      }
      advanceConfirmStep();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save topics.');
    }
  }

  function advanceConfirmStep() {
    const nextStep = confirmStep + 1;
    if (nextStep >= confirmSteps.length) {
      setPhase('reference');
    } else {
      setConfirmStep(nextStep);
    }
  }

  async function handleAnalyseReferences() {
    const handles = referenceHandles.filter((h) => h.trim());
    if (handles.length === 0) return;

    setIsAnalysing(true);
    setError(null);

    try {
      const response = await analysisApi.analyseReferenceAccounts(analysisId, handles);
      setReferenceResults(response.data?.referenceAccounts || []);
      if (Array.isArray(response?.data?.gapMap)) {
        setGapMap(sanitizeGapMapForUi(response.data.gapMap, 5));
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to analyse reference accounts.');
    } finally {
      setIsAnalysing(false);
    }
  }

  async function handleGeneratePrompts() {
    setError(null);
    setIsGenerating(true);

    try {
      // Send additional context if provided
      if (deeperUrl || deeperContext) {
        await analysisApi.confirmStep(analysisId, 'extra_context', {
          deeper_url: deeperUrl,
          deeper_context: deeperContext
        });
      }

      const response = await analysisApi.generatePrompts(analysisId, strategyId);
      const contentPlan = response?.data?.contentPlan;

      if (contentPlan?.warning) {
        toast.error(contentPlan.warning);
      } else {
        toast.success('Prompt Pack and Content Plan generated.');
      }

      onComplete?.({ next: 'prompts', contentPlan });
    } catch (err) {
      console.error('[AnalysisFlow] Failed to start prompt generation:', err);
      setError(err.response?.data?.error || 'Failed to start prompt generation.');
    } finally {
      setIsGenerating(false);
    }
  }
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default AnalysisFlow;
