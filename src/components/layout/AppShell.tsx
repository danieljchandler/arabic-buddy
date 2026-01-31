import { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

const AppShell = ({ children, className = '' }: AppShellProps) => {
  return (
    <div className={`min-h-screen bg-background ${className}`}>
      {children}
    </div>
  );
};

export default AppShell;
