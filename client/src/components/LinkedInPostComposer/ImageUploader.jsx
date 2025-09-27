import React from "react";

// Placeholder for ImageUploader component
const ImageUploader = ({ onImageUpload }) => {
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && onImageUpload) {
      // For placeholder, just return a fake URL
      onImageUpload(URL.createObjectURL(file));
    }
  };

  return (
    <div className="p-4 border rounded bg-gray-50">
      <h3 className="font-semibold mb-2">Image Uploader</h3>
      <input type="file" accept="image/*" onChange={handleFileChange} />
    </div>
  );
};

export default ImageUploader;
