import React, { useState, useRef, useEffect } from 'react';
import { Bold, Italic, Underline } from 'lucide-react';

/**
 * A text editor that shows formatting options when text is selected
 * Supports bold, italic, and underline using LinkedIn's unicode characters
 */
const SelectionTextEditor = ({ value, onChange, placeholder, className, disabled, rows = 5 }) => {
  const [selection, setSelection] = useState({ start: 0, end: 0, hasSelection: false });
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0, visible: false });
  const textareaRef = useRef(null);
  const toolbarRef = useRef(null);

  // Unicode character mappings for formatting
  const unicodeMaps = {
    bold: {
      a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶', j: '𝗷',
      k: '𝗸', l: '𝗹', m: '𝗺', n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿', s: '𝘀', t: '𝘁',
      u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
      A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜', J: '𝗝',
      K: '𝗞', L: '𝗟', M: '𝗠', N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧',
      U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
      0: '𝟬', 1: '𝟭', 2: '𝟮', 3: '𝟯', 4: '𝟰', 5: '𝟱', 6: '𝟲', 7: '𝟳', 8: '𝟴', 9: '𝟵'
    },
    italic: {
      a: '𝘢', b: '𝘣', c: '𝘤', d: '𝘥', e: '𝘦', f: '𝘧', g: '𝘨', h: '𝘩', i: '𝘪', j: '𝘫',
      k: '𝘬', l: '𝘭', m: '𝘮', n: '𝘯', o: '𝘰', p: '𝘱', q: '𝘲', r: '𝘳', s: '𝘴', t: '𝘵',
      u: '𝘶', v: '𝘷', w: '𝘸', x: '𝘹', y: '𝘺', z: '𝘻',
      A: '𝘈', B: '𝘉', C: '𝘊', D: '𝘋', E: '𝘌', F: '𝘍', G: '𝘎', H: '𝘏', I: '𝘐', J: '𝘑',
      K: '𝘒', L: '𝘓', M: '𝘔', N: '𝘕', O: '𝘖', P: '𝘗', Q: '𝘘', R: '𝘙', S: '𝘚', T: '𝘛',
      U: '𝘜', V: '𝘝', W: '𝘞', X: '𝘟', Y: '𝘠', Z: '𝘡'
    }
  };

  // Handle text selection
  const handleSelect = () => {
    if (!textareaRef.current || disabled) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const hasSelection = end > start;

    setSelection({ start, end, hasSelection });

    if (hasSelection) {
      // Calculate toolbar position
      const textarea = textareaRef.current;
      const rect = textarea.getBoundingClientRect();
      const scrollTop = textarea.scrollTop;
      
      // Get selection coordinates (approximate)
      const lines = value.substring(0, start).split('\n').length;
      const lineHeight = 24; // approximate
      const top = rect.top - 50 + (lines * lineHeight) - scrollTop;
      const left = rect.left + rect.width / 2;

      setToolbarPosition({ top, left, visible: true });
    } else {
      setToolbarPosition(prev => ({ ...prev, visible: false }));
    }
  };

  // Apply formatting
  const applyFormat = (formatType) => {
    if (!selection.hasSelection) return;

    const { start, end } = selection;
    const selectedText = value.substring(start, end);
    let formattedText = '';

    if (formatType === 'underline') {
      // Add underline using combining character
      formattedText = selectedText.split('').map(char => {
        if (char === ' ' || char === '\n') return char;
        return char + '\u0332'; // combining low line
      }).join('');
    } else if (formatType === 'bold' || formatType === 'italic') {
      // Convert to unicode bold/italic
      const map = unicodeMaps[formatType];
      formattedText = selectedText.split('').map(char => map[char] || char).join('');
    }

    const newValue = value.substring(0, start) + formattedText + value.substring(end);
    onChange({ target: { value: newValue } });

    // Hide toolbar
    setToolbarPosition(prev => ({ ...prev, visible: false }));

    // Restore focus
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start, start + formattedText.length);
      }
    }, 0);
  };

  // Hide toolbar when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target)
      ) {
        setToolbarPosition(prev => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onSelect={handleSelect}
        onMouseUp={handleSelect}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        rows={rows}
      />

      {/* Formatting Toolbar */}
      {toolbarPosition.visible && (
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-1 bg-gray-900 text-white rounded-lg shadow-xl px-2 py-1.5 transform -translate-x-1/2"
          style={{
            top: `${toolbarPosition.top}px`,
            left: `${toolbarPosition.left}px`,
          }}
        >
          <button
            type="button"
            onClick={() => applyFormat('bold')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('italic')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => applyFormat('underline')}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Underline"
          >
            <Underline className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default SelectionTextEditor;
