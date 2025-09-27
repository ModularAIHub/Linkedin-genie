import React, { useState } from 'react';

const Collapsible = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded mb-2 bg-blue-50">
      <button
        className="w-full flex items-center justify-between px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#0077B5]"
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span className="font-semibold text-blue-800 text-left truncate">{title}</span>
        <span className="ml-2 text-[#0077B5] text-lg">{open ? '\u2212' : '+'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
};

export default Collapsible;
