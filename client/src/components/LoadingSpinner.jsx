import React from 'react';
import clsx from 'clsx';

const LoadingSpinner = ({ size = 'md', className, ...props }) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
    xl: 'h-12 w-12',
  };
  return (
    <div
      className={clsx(
        'animate-spin rounded-full border-2 border-blue-200 border-t-[#0077B5]',
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
};

export default LoadingSpinner;
