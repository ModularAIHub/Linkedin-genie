import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { plainTextToEditorHtml } from '../utils/editorHtml';

export default function useComposerInitialPayload({
  hasApplied,
  setHasApplied,
  setContent,
  setAiPrompt,
  setShowAIPrompt,
  handleAIButtonClick,
  showAIPrompt,
}) {
  const location = useLocation();

  useEffect(() => {
    if (hasApplied) return;

    let draftContent = '';
    const stateDraftPayload = location?.state?.composerDraftContent;
    if (typeof stateDraftPayload === 'string') {
      draftContent = String(stateDraftPayload || '').trim();
    } else if (stateDraftPayload && typeof stateDraftPayload === 'object') {
      draftContent = String(stateDraftPayload.content || stateDraftPayload.text || '').trim();
    }

    if (!draftContent) {
      const storedDraftRaw = localStorage.getItem('composerDraftContent');
      if (storedDraftRaw) {
        try {
          const parsedDraft = JSON.parse(storedDraftRaw);
          if (typeof parsedDraft === 'string') {
            draftContent = String(parsedDraft || '').trim();
          } else if (parsedDraft && typeof parsedDraft === 'object') {
            draftContent = String(parsedDraft.content || parsedDraft.text || '').trim();
          }
        } catch {
          draftContent = String(storedDraftRaw || '').trim();
        }
      }
    }

    if (draftContent && setContent) {
      setContent(plainTextToEditorHtml(draftContent));
      localStorage.removeItem('composerDraftContent');
      setHasApplied(true);
      return;
    }

    let promptText = '';
    const statePayload = location?.state?.composerPromptPayload;
    if (statePayload?.text) {
      promptText = String(statePayload.text);
    } else {
      const storedPayload = localStorage.getItem('composerPromptPayload');
      if (storedPayload) {
        try {
          const parsed = JSON.parse(storedPayload);
          promptText = parsed?.text ? String(parsed.text) : '';
        } catch {
          promptText = '';
        }
      }
      if (!promptText) {
        const storedPrompt = localStorage.getItem('composerPrompt');
        promptText = storedPrompt ? String(storedPrompt) : '';
      }
    }

    if (promptText && setAiPrompt && handleAIButtonClick) {
      setAiPrompt(promptText);
      localStorage.removeItem('composerPrompt');
      localStorage.removeItem('composerPromptPayload');
      if (typeof setShowAIPrompt === 'function') {
        setShowAIPrompt(true);
      } else {
        setTimeout(() => {
          if (!showAIPrompt) handleAIButtonClick();
        }, 80);
      }
    }

    setHasApplied(true);
  }, [
    hasApplied,
    location,
    setContent,
    setAiPrompt,
    setShowAIPrompt,
    handleAIButtonClick,
    showAIPrompt,
    setHasApplied,
  ]);
}
