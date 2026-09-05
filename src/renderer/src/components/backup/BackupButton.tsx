import { HardDriveDownload } from 'lucide-react'

import { Button, type ButtonProps } from '@/components/ui/button'

interface BackupButtonProps extends ButtonProps {
  onClick: () => void
}

/**
 * 备份触发按钮（要求 #1）
 *
 * 设计原则：
 * - 显眼：使用 primary 色变体（默认），左侧带下载图标
 * - 任何阶段可触发：父组件把它放在顶部全局栏，永远可达
 * - 可访问：带 aria-label，键盘可达
 */
export function BackupButton({ onClick, className, ...props }: BackupButtonProps) {
  return (
    <Button
      variant="default"
      onClick={onClick}
      aria-label="创建备份"
      title="主动备份当前数据"
      className={className}
      {...props}
    >
      <HardDriveDownload className="h-4 w-4" />
      备份
    </Button>
  )
}
