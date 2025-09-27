import React, { useState } from 'react';
import { Send, Calendar } from 'lucide-react';
import Modal from '../Modal';

const LinkedInPostActions = ({
  isCarousel,
  content,
  carouselSlides,
  selectedImages,
  isPosting,
  isScheduling,
  onPost,
  onSchedule
}) => {
  const hasContent = isCarousel 
    ? carouselSlides.some(slide => slide.trim().length > 0)
    : content.trim().length > 0;
  const canPost = hasContent || selectedImages.length > 0;
  // Modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [localError, setLocalError] = useState('');
  // Detect user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="flex space-x-3">
      <button
        onClick={onPost}
        disabled={!canPost || isPosting}
        className="flex-1 flex items-center justify-center px-4 py-2 bg-[#0077B5] text-white rounded-md hover:bg-[#005983] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPosting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Posting...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            {isCarousel ? 'Post Carousel' : 'Post'}
          </>
        )}
      </button>
      <button
        onClick={() => setShowScheduleModal(true)}
        disabled={!canPost || isScheduling}
        className="flex items-center px-4 py-2 border border-blue-300 text-[#0077B5] rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isScheduling ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#0077B5] mr-2"></div>
            Scheduling...
          </>
        ) : (
          <>
            <Calendar className="h-4 w-4 mr-2" />
            Schedule
          </>
        )}
      </button>
      {/* Schedule Modal */}
      <Modal isOpen={showScheduleModal} onClose={() => { setShowScheduleModal(false); setLocalError(''); }}>
        <h2 className="text-lg font-semibold mb-4">Schedule LinkedIn Post</h2>
        <label className="block text-sm font-medium text-[#0077B5] mb-2">Date & Time</label>
        <input
          type="datetime-local"
          value={scheduleDate}
          min={new Date().toISOString().slice(0, 16)}
          onChange={e => setScheduleDate(e.target.value)}
          className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0077B5] mb-4"
        />
        {localError && <div className="text-red-500 text-sm mb-2">{localError}</div>}
        <div className="flex justify-end space-x-2 mt-4">
          <button
            className="px-4 py-2 bg-blue-100 rounded hover:bg-blue-200"
            onClick={() => { setShowScheduleModal(false); setLocalError(''); }}
            disabled={isScheduling}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-[#0077B5] text-white rounded hover:bg-[#005983] disabled:opacity-50"
            onClick={async () => {
              if (!scheduleDate) {
                setLocalError('Please select a date and time');
                return;
              }
              setLocalError('');
              await onSchedule(scheduleDate, userTimezone);
              setShowScheduleModal(false);
              setScheduleDate('');
            }}
            disabled={isScheduling}
          >
            {isScheduling ? 'Scheduling...' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default LinkedInPostActions;
