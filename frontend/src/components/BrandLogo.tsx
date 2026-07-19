import React from 'react';

export type LogoSize = 'hero' | 'large' | 'medium' | 'small' | 'icon';

interface BrandLogoProps {
  size: LogoSize;
  className?: string;
}

export default function BrandLogo({ size, className = '' }: BrandLogoProps) {
  // Map size variants to precise tailwind dimensions
  const sizeMap: Record<LogoSize, string> = {
    hero: 'w-[112px] h-[112px] rounded-2xl',
    large: 'w-[72px] h-[72px] rounded-2xl',
    medium: 'w-[56px] h-[56px] rounded-2xl',
    small: 'w-[40px] h-[40px] rounded-xl',
    icon: 'w-[24px] h-[24px] rounded-lg'
  };

  const selectedSizeClass = sizeMap[size] || sizeMap.medium;

  return (
    <img
      src="/logo.jpg"
      alt="Agent Karuppu Logo"
      className={`object-cover border border-purple-500/20 shadow-lg shadow-purple-500/10 transition-all duration-300 ${selectedSizeClass} ${className}`}
    />
  );
}
