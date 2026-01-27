import React from 'react';
import { PropertiesPanel } from './PropertiesPanel';
import { ZoomSectionList } from './ZoomSectionList';

export function Sidebar() {
  return (
    <div className="w-[280px] bg-[#161616] border-l border-white/[0.06] flex flex-col overflow-y-auto">
      <PropertiesPanel />
      <ZoomSectionList />
    </div>
  );
}
