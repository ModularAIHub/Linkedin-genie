import { MessageSquare, Layout, Library, Sparkles, Database } from 'lucide-react';

export const isReconnectRequiredError = (error) =>
  error?.response?.data?.code === 'LINKEDIN_RECONNECT_REQUIRED' ||
  error?.response?.data?.code === 'TWITTER_RECONNECT_REQUIRED' ||
  error?.response?.data?.reconnect === true;

export const STRATEGY_TEMPLATES = [
  {
    name: 'Founder Build in Public',
    description: 'Share product progress, lessons, and customer wins every week.',
  },
  {
    name: 'Niche Expert Growth',
    description: 'Teach one topic deeply and build authority with practical LinkedIn posts.',
  },
  {
    name: 'Creator Audience Engine',
    description: 'Use storytelling plus educational hooks to grow followers.',
  },
];

export const VIEW_META = {
  chat: {
    title: 'Setup',
    subtitle: 'Define niche, audience, goals, and context',
    icon: MessageSquare,
  },
  overview: {
    title: 'Review',
    subtitle: 'Inspect strategy quality before generation',
    icon: Layout,
  },
  prompts: {
    title: 'Prompt Pack',
    subtitle: 'Use production-ready ideas in compose/bulk',
    icon: Library,
  },
  content: {
    title: 'Content Plan',
    subtitle: 'Approve and publish ready posts',
    icon: Sparkles,
  },
  vault: {
    title: 'Context Vault',
    subtitle: 'Inspect memory signals and refresh state',
    icon: Database,
  },
};

const STRATEGY_LABEL_MARKERS = ['what we do', 'key features', 'why suitegenie', 'perfect for'];

export const compactStrategyLabel = (value = '') => {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Untitled strategy';

  const lower = text.toLowerCase();
  for (const marker of STRATEGY_LABEL_MARKERS) {
    const index = lower.indexOf(marker);
    if (index > 0) {
      text = text.slice(0, index).trim();
      break;
    }
  }

  text = text.replace(/\s*[|:-]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Untitled strategy';
  if (text.length > 70) return `${text.slice(0, 67).trim()}...`;
  return text;
};
