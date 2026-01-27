import React from 'react';
import { Card, CardTitle } from '../../../shared/components';

interface SettingsGroupProps {
  title: string;
  children: React.ReactNode;
}

export function SettingsGroup({ title, children }: SettingsGroupProps) {
  return (
    <Card className="mb-5 last:mb-0">
      <CardTitle>{title}</CardTitle>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}
