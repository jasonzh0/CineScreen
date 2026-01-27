import React from 'react';
import iconUrl from '../../../assets/icon.png';

export function Header() {
  return (
    <header className="text-center mb-10 pb-6 border-b border-white/[0.06]">
      <div className="flex items-center justify-center gap-3 mb-3">
        <img
          src={iconUrl}
          alt="CineScreen"
          className="w-12 h-12 rounded-lg object-contain"
        />
        <h1 className="text-3xl font-bold text-white tracking-tight">CineScreen</h1>
      </div>
      <p className="text-sm text-[#808080] tracking-wide">
        Professional screen recordings with cinematic animations and effects
      </p>
    </header>
  );
}
