---
name: 求解与代码迭代
description: 用 Python 实现模型、运行并迭代，产出可信数值与图表（工作流第④步）
---

# 求解与代码迭代技能

依据 workspace/notes/model-design.md 的方案，逐问用 python_exec 实现与求解：

## 1. 脚本组织
- 每问一个脚本，放 workspace/code/，英文命名 qX_描述.py（如 q1_regression.py）
- 脚本开头统一输出 UTF-8，避免 Windows 中文乱码：
  ```python
  import sys, io
  sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
  ```
- 先算后画：先完成全部计算得到数值并打印统计量，再绘图

## 2. 运行与防绕圈
- 写码前先用 file_read 确认 workspace/data/ 数据列名与类型，一次写对
- 同一脚本最多调试 3 次；仍失败则换方案重写，勿反复修同一错误
- 数值结论必须来自真实运行输出；算不出/报错/数据不足如实说明，绝不假装成功或凭记忆填"文献值"

## 3. 输出规范
- 图保存到 workspace/figures/fig_qX_序号.png（英文名；图上不写中文标题）
- 中间/结果表保存为 workspace/data/qX_*.csv
- 控制台文本结果放 workspace/outputs/（如需要）
- 论文要用的图，之后再复制到 paper/figures/

## 4. 每问收尾
- 汇总该问的数值结果、图路径、表路径，明确写出"数据来自 qX_*.py 第 N 次运行输出"
- 记录关键参数与超参（供后续论文灵敏度/检验章节引用）

## 铁律
- 只用 ASCII 英文文件名；图表先算后画；结论附可核验的来源
