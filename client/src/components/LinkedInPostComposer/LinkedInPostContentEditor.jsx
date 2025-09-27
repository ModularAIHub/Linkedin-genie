
import React, { useRef, useEffect } from 'react';
import { Sparkles, Wand2, Bold, Italic, Underline } from 'lucide-react';

// Move htmlToUnicode outside the component so it can be exported
// Unicode mapping helpers
const toUnicode = (str, style) => {
  const bold = {
    A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜', J: '𝗝', K: '𝗞', L: '𝗟', M: '𝗠', N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧', U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
    a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶', j: '𝗷', k: '𝗸', l: '𝗹', m: '𝗺', n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿', s: '𝘀', t: '𝘁', u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
  };
  const italic = {
    A: '𝐴', B: '𝐵', C: '𝐶', D: '𝐷', E: '𝐸', F: '𝐹', G: '𝐺', H: '𝐻', I: '𝐼', J: '𝐽', K: '𝐾', L: '𝐿', M: '𝑀', N: '𝑁', O: '𝑂', P: '𝑃', Q: '𝑄', R: '𝑅', S: '𝑆', T: '𝑇', U: '𝑈', V: '𝑉', W: '𝑊', X: '𝑋', Y: '𝑌', Z: '𝑍',
    a: '𝑎', b: '𝑏', c: '𝑐', d: '𝑑', e: '𝑒', f: '𝑓', g: '𝑔', h: 'ℎ', i: '𝑖', j: '𝑗', k: '𝑘', l: '𝑙', m: '𝑚', n: '𝑛', o: '𝑜', p: '𝑝', q: '𝑞', r: '𝑟', s: '𝑠', t: '𝑡', u: '𝑢', v: '𝑣', w: '𝑤', x: '𝑥', y: '𝑦', z: '𝑧',
  };
  const underline = (s) => s.split('').map(c => c + '\u0332').join('');
  if (style === 'bold') return str.replace(/[A-Za-z]/g, c => bold[c] || c);
  if (style === 'italic') return str.replace(/[A-Za-z]/g, c => italic[c] || c);
  if (style === 'underline') return underline(str);
  return str;
};

// Convert HTML to Unicode preview
const htmlToUnicode = (html) => {
  let out = html
    .replace(/<b>(.*?)<\/b>/gi, (_, t) => toUnicode(t, 'bold'))
    .replace(/<strong>(.*?)<\/strong>/gi, (_, t) => toUnicode(t, 'bold'))
    .replace(/<i>(.*?)<\/i>/gi, (_, t) => toUnicode(t, 'italic'))
    .replace(/<em>(.*?)<\/em>/gi, (_, t) => toUnicode(t, 'italic'))
    .replace(/<u>(.*?)<\/u>/gi, (_, t) => toUnicode(t, 'underline'));
  // Remove all other tags except <br> and <div>
  out = out.replace(/<(?!br\s*\/?>|div\s*\/?>)[^>]+>/gi, '');
  // Convert <div> and <br> to newlines (handle all cases)
  out = out
    .replace(/<div><br\s*\/?>/gi, '\n') // empty divs
    .replace(/<div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '');
  // Remove leading newline if present
  if (out.startsWith('\n')) out = out.slice(1);
  return out;
};

const LinkedInPostContentEditor = ({
  content,
  setContent,
  onAIButtonClick,
  onImageButtonClick,
  showAIPrompt,
  showImagePrompt
}) => {
  const editorRef = useRef(null);

  // Formatting actions
  const format = (command) => {
    document.execCommand(command, false, null);
    // Sync content to parent
    if (editorRef.current) setContent(editorRef.current.innerHTML);
  };

  // Handle input and sync to parent, only if changed
  const handleInput = (e) => {
    const html = e.currentTarget.innerHTML;
    if (html !== content) setContent(html);
  };

  // Keep editor in sync with content prop (for AI insert, etc)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== content) {
      editorRef.current.innerHTML = content || '';
    }
  }, [content]);



  // Count characters (excluding tags)
  const characterCount = (content.replace(/<[^>]+>/g, '') || '').length;

  return (
  <div className="space-y-4 bg-white rounded-xl shadow-lg border border-gray-100 p-4 md:p-6">
      {/* Action Buttons - Compact UI */}
  <div className="flex flex-wrap gap-2 mb-3 items-center">
        <button
          onClick={onAIButtonClick}
          className={`flex items-center px-3 py-1.5 rounded-md font-medium text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0077B5] ${showAIPrompt ? 'bg-[#0077B5] text-white hover:bg-blue-800' : 'bg-blue-100 text-[#0077B5] hover:bg-blue-200'}`}
        >
          <Sparkles className="h-4 w-4 mr-1" />
          {showAIPrompt ? 'Cancel AI' : 'AI Generate'}
        </button>
        <button
          onClick={onImageButtonClick}
          className={`flex items-center px-3 py-1.5 rounded-md font-medium text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0077B5] ${showImagePrompt ? 'bg-[#0077B5] text-white hover:bg-blue-800' : 'bg-blue-100 text-[#0077B5] hover:bg-blue-200'}`}
        >
          <Wand2 className="h-4 w-4 mr-1" />
          {showImagePrompt ? 'Cancel' : 'AI Image'}
        </button>
        {/* Formatting Buttons */}
        <button
          type="button"
          className="btn btn-sm btn-outline flex items-center justify-center w-8 h-8 p-0 hover:bg-blue-50 focus:bg-blue-100 border border-blue-200 rounded transition"
          onClick={() => format('bold')}
          title="Bold (Ctrl+B)"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline flex items-center justify-center w-8 h-8 p-0 hover:bg-blue-50 focus:bg-blue-100 border border-blue-200 rounded transition"
          onClick={() => format('italic')}
          title="Italic (Ctrl+I)"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline flex items-center justify-center w-8 h-8 p-0 hover:bg-blue-50 focus:bg-blue-100 border border-blue-200 rounded transition"
          onClick={() => format('underline')}
          title="Underline (Ctrl+U)"
        >
          <Underline className="w-4 h-4" />
        </button>
      </div>
      {/* Content Editor - Rich Text */}
      <div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="w-full px-4 py-3 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0077B5] min-h-[120px] text-base bg-white transition-shadow focus:shadow-lg text-lg max-w-3xl mx-auto"
          data-placeholder="What do you want to share with your professional network?"
          onInput={handleInput}
          style={{ whiteSpace: 'pre-wrap', position: 'relative' }}
        />
        {/* Placeholder styling for contentEditable */}
        <style>{`
          [contenteditable][data-placeholder]:empty:before {
            content: attr(data-placeholder);
            color: #a0aec0;
            pointer-events: none;
            position: absolute;
          }
        `}</style>
        <div className="flex justify-between items-center mt-2">
          <span className={`text-xs ${characterCount > 3000 ? 'text-red-500' : 'text-blue-500'}`}>
            {characterCount}/3000 characters
          </span>
        </div>
      </div>
      {/* Live Preview */}
  <div className="mt-7 p-6 bg-blue-50 border border-blue-100 rounded-lg shadow-sm max-w-3xl mx-auto">
        <div className="text-xs text-blue-700 mb-2 font-semibold tracking-wide uppercase">Preview</div>
        <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '1rem', color: '#222' }}>{htmlToUnicode(content)}</div>
      </div>
    </div>
  );
};

export default LinkedInPostContentEditor;
export { htmlToUnicode };
