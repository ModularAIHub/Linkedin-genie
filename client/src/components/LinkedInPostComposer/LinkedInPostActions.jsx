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
    <div className="flex flex-col gap-2 sm:flex-row sm:space-x-3 w-full">
      <button
        onClick={onPost}
        disabled={!canPost || isPosting}
        className="w-full sm:w-auto sm:flex-1 flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md font-semibold text-base transition-all"
      >
        {isPosting ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
            Posting...
          </>
        ) : (
          <>
            <Send className="h-5 w-5 mr-2" />
            {isCarousel ? 'Post Carousel Now' : 'Post Now'}
          </>
        )}
      </button>
      <button
        onClick={() => setShowScheduleModal(true)}
        disabled={!canPost || isScheduling}
        className="w-full sm:w-auto sm:flex-1 flex items-center justify-center px-6 py-3 border-2 border-blue-600 text-blue-600 bg-white rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm font-medium text-base transition-all"
      >
        {isScheduling ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-2"></div>
            Scheduling...
          </>
        ) : (
          <>
            <Calendar className="h-5 w-5 mr-2" />
            Schedule for Later
          </>
        )}
      </button>
      {/* Schedule Modal */}
      <Modal isOpen={showScheduleModal} onClose={() => { setShowScheduleModal(false); setLocalError(''); }}>
        <h2 className="text-lg font-semibold mb-4">Schedule LinkedIn Post</h2>
        <label className="block text-sm font-medium text-gray-700 mb-2">Date & Time</label>
        <input
          type="datetime-local"
          value={scheduleDate}
          min={new Date().toISOString().slice(0, 16)}
          onChange={e => setScheduleDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
        />
        {localError && <div className="text-red-500 text-sm mb-2">{localError}</div>}
        <div className="flex justify-end space-x-2 mt-4">
          <button
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={() => { setShowScheduleModal(false); setLocalError(''); }}
            disabled={isScheduling}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
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
