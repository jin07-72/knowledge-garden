---
title: 大物
date: 2026-10-11
updated: 2026-10-22
description: 电科格院大二吴喆大学物理
tags:
  - 大学
  - 物理
---

# 大物

> **笔记概述**：持续更新的**大学物理课程笔记**。
>
> **整理原则**：以课程课件为基础保留原有知识组织与典型问题，并把重要推导整理为可复制的 LaTeX 公式；部分例题含帮助理解的补充步骤，个别题目为明确标注的练习化改写。例题不是课件原文逐页转录。静电学部分默认真空或空气环境（除非题目说明介质），忽略边缘效应时会注明。
>
> **插图与扩展**：例题插图为依据题设**重新绘制的简化物理示意图**（非课件原图、不一定按比例）。原笔记引用的旧图片未随本次文件上传，因此本版已依据笔记中的题目文字重新绘制配图。所有图片位于本文件同级 `_assets/physics/`；移动或上传笔记时须一并保留图片文件夹。


### 学习目录（依课件章号）

| 部分 | 章节 | 进度 |
| --- | --- | --- |
| 静电学 | 第 19–22 章：电场、高斯定律、电势、电容 | 保留并修订原笔记 |
| 磁学 | 第 25–26 章：磁力、磁场来源与环路定律 | 本次新增 |
| 电磁感应与电磁波 | 第 27–29 章：感应、电感、麦克斯韦方程 | 本次新增 |
| 相对论 | 第 32 章：狭义相对论 | 本次新增 |
| 量子理论 | 第 33 章：早期量子理论；第 35 章：原子量子力学 | 本次新增 |
| 暂未整理 | 第 23–24、30–31、34 章 | 尚缺对应课件 |

> 阅读建议：保留公式中的向量箭头及正负号；每道题先画方向图、写适用条件，再积分或代数运算。本笔记中的补充模型与原课件案例明确区分。

**原有静电学知识脉络**：电荷产生电场 → 利用对称性求电场 → 由电场定义电势和电势能 → 用电容描述储能与介质效应。

**常用常数和符号**：

| 符号                            | 含义                   | 常用值 / 单位                            |
| ------------------------------- | ---------------------- | ---------------------------------------- |
| $e$                             | 元电荷量的大小         | $1.602\times10^{-19}\,\mathrm C$         |
| $\varepsilon_0$                 | 真空介电常数           | $8.854\times10^{-12}\,\mathrm{F/m}$      |
| $k=1/(4\pi\varepsilon_0)$       | 库仑常数               | $8.99\times10^9\,\mathrm{N\,m^2/C^2}$    |
| $\lambda=\mathrm dQ/\mathrm dl$ | 线电荷密度             | $\mathrm{C/m}$                           |
| $\sigma=\mathrm dQ/\mathrm dS$  | 面电荷密度             | $\mathrm{C/m^2}$                         |
| $\rho=\mathrm dQ/\mathrm dV$    | 体电荷密度             | $\mathrm{C/m^3}$                         |
| $\vec E$、$V$、$U$              | 电场强度、电势、电势能 | $\mathrm{N/C}$、$\mathrm V$、$\mathrm J$ |

---

## 第 19 章：电荷与电场（Electric Charge and Electric Field）

### 19-1 电荷的基本性质（Electric Charges）

1. **两种电荷**：正电荷和负电荷；同号相斥、异号相吸。
2. **电荷量子化**：电荷以元电荷量 $e$ 为基本单位，普通物体净电荷量可写为 $q=ne$，其中 $n$ 为整数。
3. **电荷守恒**：孤立系统中的电荷代数和不变；摩擦、接触和静电感应使电荷转移或重新分布，而不凭空产生净电荷。
4. **材料分类**：导体含可移动电荷，绝缘体中电荷较难自由移动；半导体的导电能力介于两者之间且可受外部条件调控。

### 19-2 库仑定律（Coulomb's Law）

两**静止点电荷** $q_1,q_2$ 相距 $r$，相互作用力大小为

$$
F=k\frac{|q_1q_2|}{r^2}=\frac{1}{4\pi\varepsilon_0}\frac{|q_1q_2|}{r^2}.
$$

若 $\hat{\boldsymbol r}_{12}$ 表示由 $q_1$ 指向 $q_2$ 的单位矢量，则 **$q_1$ 对 $q_2$ 的力**为

$$
\vec F_{1\to 2}=k\frac{q_1q_2}{r^2}\hat{\boldsymbol r}_{12}.
$$

- 适用条件：静电学中的点电荷；具有球对称的电荷分布在**球外**可等效为点电荷。
- **叠加原理**：合力是各个电荷分别施加的力的**矢量和**，$\vec F=\sum_i\vec F_i$。
- 计算时先看正负号确定方向，再对各分量进行代数运算；不要直接把力的大小相加。

### 19-3 电场与电场线（Electric Field）

**电场的定义**：在某处放入足够小的正试探电荷 $q_0$，

$$
\boxed{\vec E=\frac{\vec F}{q_0}}
$$

电场由**场源电荷**决定，与所选试探电荷的电荷量无关。点电荷 $Q$ 的电场为

$$
\boxed{\vec E(\vec r)=k\frac{Q}{r^2}\hat{\boldsymbol r}}
$$

这里 $\hat{\boldsymbol r}$ 从场源指向场点：$Q>0$ 时场向外，$Q<0$ 时场向内。多个点电荷共同产生的电场满足

$$
\vec E_{\mathrm{total}}=\sum_i\vec E_i.
$$

**电场线的判读**：切线方向为电场方向；同一图中电场线越密，场越强；电场线从正电荷出发、在负电荷处终止（或延伸至无穷远），彼此不相交。电场线只是表示场的工具，并非真实轨迹。

### 19-3.1 连续带电体的积分法

当电荷连续分布时，取微元 $\mathrm dQ$，利用叠加原理积分：

$$
\boxed{\mathrm d\vec E=k\frac{\mathrm dQ}{r^2}\hat{\boldsymbol r},\qquad \vec E=\int\mathrm d\vec E}
$$

其中

$$
\mathrm dQ=\lambda\,\mathrm dl,\qquad
\mathrm dQ=\sigma\,\mathrm dS,\qquad
\mathrm dQ=\rho\,\mathrm dV.
$$

**通用解题顺序**：建立坐标 → 找电荷微元 → 写出微元电场 → 利用对称性消去相互抵消的分量 → 积分剩余分量 → 检查远场、中心或无限长极限。

常用结果（真空中、按题述对称条件）：

| 电荷分布             | 电场结果                                                                     | 条件                      |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| 无限长均匀带电直线   | $E=\dfrac{\lvert\lambda\rvert}{2\pi\varepsilon_0r}$ | $r$ 是到直线的垂距 |
| 无限大均匀带电平面   | $E=\dfrac{\lvert\sigma\rvert}{2\varepsilon_0}$ | 平面每一侧，方向垂直平面 |
| 均匀带电圆环的轴线上 | $E_x=k\dfrac{Qx}{(R^2+x^2)^{3/2}}$                                           | $x$ 为带符号轴向坐标      |
| 均匀带电圆盘轴线上   | $E_x=\dfrac{\sigma}{2\varepsilon_0}\left(1-\dfrac{x}{\sqrt{x^2+R^2}}\right)$ | $x>0$；另一侧按对称性处理 |

> **区分**：无限大**非导体带电薄平面**每侧 $E=\sigma/(2\varepsilon_0)$；**导体表面紧外侧** $E_n=\sigma/\varepsilon_0$，因为导体内 $E=0$。这两条公式的物理情境不同。

### 19-4 电偶极子（Electric Dipole）

一对相距很近、大小相等且符号相反的电荷 $+q,-q$ 构成电偶极子。定义电偶极矩

$$
\boxed{\vec p=q\vec d}
$$

其中 $\vec d$ **由负电荷指向正电荷**。若放在**匀强电场**中，

$$
\vec F_{\mathrm{net}}=0,\qquad
\boxed{\vec\tau=\vec p\times\vec E},\qquad
\tau=pE\sin\theta.
$$

电偶极子的势能为 $U=-\vec p\cdot\vec E=-pE\cos\theta$（选择相应零点）。$\vec p$ 与 $\vec E$ 同向时为稳定平衡，反向时为不稳定平衡。非匀强电场中一般还会有合力。

### 19 章典型例题与解题思路

#### 例题 19-1：两个负电荷与第三个电荷的平衡（课件例 1，第 20 页）

![ch19-ex01](./_assets/physics/ch19-ex01.png)

**题目**：$-Q$ 与 $-3Q$ 相距 $l$，要使三者都处于静电平衡，应在何处放置第三个电荷，其电荷量是多少？

**思路**：两端负电荷相互排斥，若第三电荷能抵消它们受到的排斥，第三电荷必须为正且置于两者之间。先利用第三电荷处总场为零求位置，再用端点处受力平衡求电荷量。

**解答**：令 $-Q$ 在 $x=0$，$-3Q$ 在 $x=l$，第三电荷 $q$ 在 $x=a$（$0<a<l$）。

$$
\frac{kQ}{a^2}=\frac{3kQ}{(l-a)^2}
\quad\Longrightarrow\quad
\boxed{a=\frac{l}{1+\sqrt3}}.
$$

为使左侧 $-Q$ 受力平衡：

$$
\frac{kQq}{a^2}=\frac{3kQ^2}{l^2}
\quad\Longrightarrow\quad
\boxed{q=\frac{3Q}{(1+\sqrt3)^2}>0}.
$$

此时右侧 $-3Q$ 的合力也为零。**易错点**：只求出 $E=0$ 的位置，还不足以证明三个电荷都平衡；必须补充求 $q$ 并核对端点受力。

#### 例题 19-2：有限长均匀带电细棒的垂直平分线电场（课件第 22–24 页）

![ch19-ex02](./_assets/physics/ch19-ex02.png)

**题目**：长 $L$ 的细棒均匀带电，线密度为 $\lambda$。求其垂直平分线上、距棒中心 $a$ 处的电场；讨论无限长极限。

**思路**：沿棒取 $x$ 轴，棒占据 $[-L/2,L/2]$，场点在 $(0,a)$。来自 $x$ 与 $-x$ 的水平分量抵消，只需积分竖直分量。

**解答**：

$$
\mathrm dE_y=k\frac{\lambda\,\mathrm dx}{x^2+a^2}\frac{a}{\sqrt{x^2+a^2}},
$$

$$
E_y=k\lambda a\int_{-L/2}^{L/2}\frac{\mathrm dx}{(x^2+a^2)^{3/2}}
=\boxed{\frac{k\lambda L}{a\sqrt{a^2+(L/2)^2}}}.
$$

当 $L\to\infty$，$E_y\to2k\lambda/a=\lambda/(2\pi\varepsilon_0a)$。负 $\lambda$ 对应反向电场。

#### 例题 19-3：均匀带电圆环轴线电场及其极大值（课件例 3，第 26–27 页）

![ch19-ex03](./_assets/physics/ch19-ex03.png)

**题目**：半径为 $R$ 的薄圆环带总电荷 $Q>0$，求其轴线上距圆心 $x$（$x\ge0$）处的电场，以及电场最大的位置。

**思路**：圆环上电荷元的径向分量两两抵消；每个元到场点的距离同为 $\sqrt{R^2+x^2}$，只叠加轴向分量。

$$
E_x=\int k\frac{\mathrm dQ}{R^2+x^2}\frac{x}{\sqrt{R^2+x^2}}
=\boxed{k\frac{Qx}{(R^2+x^2)^{3/2}}}.
$$

令 $\mathrm dE_x/\mathrm dx=0$：

$$
\frac{\mathrm dE_x}{\mathrm dx}
=kQ\frac{R^2-2x^2}{(R^2+x^2)^{5/2}}=0
\quad\Longrightarrow\quad
\boxed{x_{\max}=\frac{R}{\sqrt2}},
$$

$$
\boxed{E_{\max}=\frac{2kQ}{3\sqrt3\,R^2}}.
$$

**检验**：$x=0$ 时 $E=0$；$x\gg R$ 时 $E\approx kQ/x^2$，圆环远看像一个点电荷。

#### 例题 19-4：带电圆盘与无限带电平面（课件例 5，第 28–29 页）

![ch19-ex04](./_assets/physics/ch19-ex04.png)

**题目**：半径 $R$ 的圆盘面密度为 $\sigma>0$。求其轴线上 $x>0$ 的电场。

**思路**：将圆盘分割为半径 $r$、宽 $\mathrm dr$ 的同心圆环，$\mathrm dQ=\sigma 2\pi r\,\mathrm dr$；直接套用圆环轴线电场积分。

$$
E_x=k\int_0^R\frac{x\,\sigma2\pi r\,\mathrm dr}{(x^2+r^2)^{3/2}}
=\boxed{\frac{\sigma}{2\varepsilon_0}\left(1-\frac{x}{\sqrt{x^2+R^2}}\right)}.
$$

令 $R\to\infty$，得到无限大薄平面单侧 $E=\sigma/(2\varepsilon_0)$。若两块无限大薄平面分别带 $+\sigma$、$-\sigma$，两板间的场相加为 $\sigma/\varepsilon_0$，外部相消为零（忽略边缘效应）。

#### 例题 19-5：带电圆环使电荷发生简谐运动（课件第 33 页）

![ch19-ex05](./_assets/physics/ch19-ex05.png)

**题目**：半径为 $R$ 的圆环带总电荷 $-Q$（$Q>0$）。质量为 $m$、电荷量为 $q>0$ 的粒子在轴线上距中心微小位移 $x$ 处释放，证明近似作简谐运动并求周期。

**思路**：先用圆环轴向电场写出力，再利用 $|x|\ll R$ 的近似；若得到 $F=-\kappa x$，即为简谐运动。

$$
F_x=-\frac{kQqx}{(R^2+x^2)^{3/2}}
\approx -\frac{kQq}{R^3}x.
$$

因此

$$
\omega^2=\frac{kQq}{mR^3},\qquad
\boxed{T=2\pi\sqrt{\frac{mR^3}{kQq}}}.
$$

仅在轴向小振幅、其他作用可忽略时成立。

---

## 第 20 章：高斯定律（Gauss's Law）

### 20-1 电通量（Electric Flux）

电通量刻画电场穿过曲面的多少。对面积为 $S$ 的**平面**及匀强电场：

$$
\Phi_E=\vec E\cdot\vec S=ES\cos\theta,
$$

其中 $\theta$ 是电场方向与**面法线**的夹角，而非与平面的夹角。任意曲面：

$$
\Phi_E=\int_S\vec E\cdot\mathrm d\vec S.
$$

闭合曲面使用带圈积分号：

$$
\boxed{\Phi_E=\oint_S\vec E\cdot\mathrm d\vec S}.
$$

**符号约定**：闭合曲面面元法线总指向外侧；电场线流出为正通量，流入为负通量。电通量可为零，即使曲面上处处存在非零电场。

### 20-2 高斯定律（Gauss's Law）

$$
\boxed{\oint_S\vec E\cdot\mathrm d\vec S=\frac{Q_{\mathrm{inside}}}{\varepsilon_0}}
$$

- $Q_{\mathrm{inside}}$ 是高斯面**内部净电荷的代数和**。
- $\vec E$ 是**内外全部电荷**共同产生的总电场；但闭合面**净通量只由内部净电荷决定**。
- $Q_{\mathrm{inside}}=0$ 只意味着 $\Phi_E=0$，**不意味着 $\vec E=0$**。
- 高斯定律对任意闭合面成立，但用它**直接解出 $E$** 一般需要球对称、柱对称或平面对称。

**高斯面选择三步法**：找对称性 → 选取能使 $E$ 恒定或 $\vec E\cdot\mathrm d\vec S=0$ 的闭合面 → 计算所围净电荷并求 $E$。高斯面是想象中的数学曲面，不是带电物体实际表面。

### 20-3 高斯定律的典型应用（Applications）

| 电荷分布                                         | 内部 $r<R$                                           | 外部 $r>R$                                |
| ------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------- |
| 半径 $R$、总电荷 $Q$ 的**均匀带电薄球壳**        | $\vec E=0$                                           | $\vec E=kQ\hat r/r^2$                     |
| 半径 $R$、总电荷 $Q$ 的**均匀带电实心绝缘球**    | $\vec E=kQr\hat r/R^3=\rho r\hat r/(3\varepsilon_0)$ | $\vec E=kQ\hat r/r^2$                     |
| 半径 $R$、体密度 $\rho$ 的**无限长实心绝缘圆柱** | $\vec E=\rho r\hat r/(2\varepsilon_0)$               | $\vec E=\rho R^2\hat r/(2\varepsilon_0r)$ |

表中 $\hat r$ 为径向向外单位矢量，负电荷时场方向由符号自然给出。边界处的场需结合表面是否有自由面电荷判断。

### 20-4 导体与高斯定律（Conductor & Gauss's Law）

**静电平衡的理想导体**具有以下性质：

1. 导体材料内部 $\vec E=0$，否则自由电荷会继续运动。
2. 导体整体为**等势体**，表面切向电场为零，紧靠表面的电场垂直表面。
3. 导体表面外侧法向电场满足 $E_n=\sigma/\varepsilon_0$（真空、表面紧外侧）。
4. 没有内部空腔电荷的普通带电孤立导体，其多余自由电荷分布在外表面；有空腔电荷时内表面可感应出电荷。
5. 导体带空腔且空腔内无电荷时，**静电平衡下空腔内电场为零**，构成静电屏蔽。外部静电场不会进入封闭导体的空腔；但空腔内电荷可能影响导体外场。
6. 表面曲率较大的尖端通常具有较大面电荷密度，也容易出现较强局部电场。

**带电空腔**：若导体本身净电荷 $Q$，在封闭空腔内放入电荷 $q$（不与导体接触），则空腔内壁感应总电荷 $-q$，导体外表面总电荷 $Q+q$。这是通过取位于导体材料中的高斯面得到的。

### 20 章典型例题与解题思路

#### 例题 20-1：均匀带电球壳（课件例 1，第 12–13 页）

![ch20-ex01](./_assets/physics/ch20-ex01.png)

**题目**：半径 $R$ 的薄球壳均匀带总电荷 $Q$，求球壳内外的电场。

**思路**：球对称保证同心球面上 $E$ 的大小相同且沿径向。取半径 $r$ 的同心球形高斯面。

$$
\oint\vec E\cdot\mathrm d\vec S=E(4\pi r^2)=\frac{Q_{\mathrm{inside}}}{\varepsilon_0}.
$$

- $r>R$：$Q_{\mathrm{inside}}=Q$，所以 $\boxed{E=kQ/r^2}$（带符号径向表达）。
- $r<R$：$Q_{\mathrm{inside}}=0$，由球对称可得 $\boxed{\vec E=0}$。

**易错点**：“包围电荷为零所以场为零”在这里成立，**是因为额外用了球对称**，不是由高斯定律单独推出的。

#### 例题 20-2：均匀带电实心绝缘球（课件例 2，第 14 页）

![ch20-ex02](./_assets/physics/ch20-ex02.png)

**题目**：半径 $R$ 的球体内均匀分布总电荷 $Q$，求 $E(r)$。

**思路**：内部高斯面只包围半径 $r$ 的部分体积，其电荷按体积比例变化。

$$
Q_{\mathrm{inside}}(r)=Q\frac{\frac43\pi r^3}{\frac43\pi R^3}=Q\frac{r^3}{R^3}.
$$

故

$$
\boxed{\vec E(r)=
\begin{cases}
\dfrac{kQr}{R^3}\hat r,&0\le r<R,\\[5pt]
\dfrac{kQ}{r^2}\hat r,&r\ge R.
\end{cases}}
$$

**物理图像**：球内 $|E|$ 随 $r$ 线性增大（假设 $Q\neq0$），球外按 $1/r^2$ 衰减；与**带电导体实心球内部 $E=0$** 区别开。

#### 例题 20-3：无限长均匀带电圆柱（课件例 3，第 16–17 页）

![ch20-ex03](./_assets/physics/ch20-ex03.png)

**题目**：半径 $R$、体电荷密度 $\rho$ 的无限长实心圆柱，求内外电场。

**思路**：取半径 $r$、长度 $L$ 的同轴圆柱形高斯面。轴向端面上 $\vec E\cdot\mathrm d\vec S=0$，仅侧面有通量。

$$
E(2\pi rL)=\frac{Q_{\mathrm{inside}}}{\varepsilon_0}.
$$

当 $r<R$ 时 $Q_{\mathrm{inside}}=\rho\pi r^2L$；当 $r>R$ 时 $Q_{\mathrm{inside}}=\rho\pi R^2L$。因此

$$
\boxed{\vec E(r)=
\begin{cases}
\dfrac{\rho r}{2\varepsilon_0}\hat r,&r<R,\\[5pt]
\dfrac{\rho R^2}{2\varepsilon_0r}\hat r,&r>R.
\end{cases}}
$$

**关键**：不要把圆柱两端面面积计入通量；它们的法线与电场垂直。

#### 例题 20-4：均匀带电球挖去偏心球形空腔（课件第 15 页）

![ch20-ex04](./_assets/physics/ch20-ex04.png)

**题目**：体电荷密度 $\rho$ 的大球体中挖去一个不共心的小球形空腔，求空腔内部电场。令 $\vec a$ 为**大球球心 $O$ 指向空腔球心 $O'$** 的位移矢量。

**思路**：用**叠加法**，把实际体系看作完整的密度为 $+\rho$ 的实心球，加上空腔位置密度为 $-\rho$ 的“虚拟球”。

对空腔内任意点 $P$，令 $\vec r=\overrightarrow{OP}$，则 $\overrightarrow{O'P}=\vec r-\vec a$。

$$
\vec E_+=\frac{\rho\vec r}{3\varepsilon_0},\qquad
\vec E_-=-\frac{\rho(\vec r-\vec a)}{3\varepsilon_0}.
$$

两者相加：

$$
\boxed{\vec E_{\mathrm{cavity}}=\frac{\rho\vec a}{3\varepsilon_0}}.
$$

**结论**：空腔内电场是**匀强电场**，且与点 $P$ 的位置无关。

#### 例题 20-5：带电导体空腔的感应电荷（课件第 19 页）

![ch20-ex05](./_assets/physics/ch20-ex05.png)

**题目**：净电荷 $Q$ 的孤立导体内部有封闭空腔，空腔内悬置电荷 $q$，求内外表面总电荷。

**思路**：选位于导体材料内部、围绕空腔的高斯面。因导体内 $E=0$，高斯面围住的净电荷为零。

$$
q+Q_{\mathrm{inner}}=0\quad\Rightarrow\quad
\boxed{Q_{\mathrm{inner}}=-q}.
$$

再结合导体本身电荷守恒：

$$
Q_{\mathrm{inner}}+Q_{\mathrm{outer}}=Q
\quad\Rightarrow\quad
\boxed{Q_{\mathrm{outer}}=Q+q}.
$$

**注意**：只能判断内外表面**总量**，不能由此断言电荷在每一处都均匀分布。

#### 例题 20-6：两块大平行金属板的四个表面电荷（课件例 4，第 22–23 页）

![ch20-ex06](./_assets/physics/ch20-ex06.png)
**题目**：面积均为 $S$ 的两块很大的平行金属板带净电荷 $Q_1,Q_2$，求四个表面的带电量和两板间电场（忽略边缘效应）。

**思路**：从左到右给四个表面依次设电荷 $q_a,q_b,q_c,q_d$。分别使用两块金属板的电荷守恒、导体内电场为零，以及平行无限带电面的叠加。

**结果**：

$$
\boxed{q_a=q_d=\frac{Q_1+Q_2}{2}},\qquad
\boxed{q_b=\frac{Q_1-Q_2}{2}},\qquad
\boxed{q_c=\frac{Q_2-Q_1}{2}}.
$$

取从左板指向右板为 $+x$ 方向，两板间电场为

$$
\boxed{\vec E_{\mathrm{gap}}=\frac{Q_1-Q_2}{2\varepsilon_0S}\hat x}.
$$

例如 $Q_1=+Q$、$Q_2=-Q$ 时，外侧均不带净电荷，内侧分别为 $+Q$、$-Q$，间隙中 $E=Q/(\varepsilon_0S)$。

---

## 第 21 章：电势与电势差（Electric Potential）

### 21-1 静电力的保守性、电势能与电势差

静电力是**保守力**：从 $a$ 到 $b$ 的做功只与端点有关，与路径无关。因此沿静电场任意闭合路径，

$$
\boxed{\oint\vec E\cdot\mathrm d\vec l=0}.
$$

定义电势能 $U$，则静电力做功

$$
W_{a\to b}^{(\mathrm e)}=U_a-U_b=-\Delta U.
$$

电势定义为**单位正电荷的电势能**（在选定参考零点之后）：

$$
\boxed{V=\frac{U}{q}},\qquad
\boxed{V_b-V_a=-\int_a^b\vec E\cdot\mathrm d\vec l}.
$$

对电荷 $q$ 有 $\Delta U=q(V_b-V_a)$ 和 $W_{a\to b}^{(\mathrm e)}=q(V_a-V_b)$。

- **电势 $V$** 是标量，电场 $\vec E$ 是矢量。
- 电势零点可任意选择，**电势差不依赖**于零点；孤立局域电荷分布通常约定 $V(\infty)=0$。
- 顺着电场方向移动，电势降低（沿场线 $\mathrm dV<0$）。**负电荷**沿电场方向移动时，其电势能反而增加，因为 $U=qV$。

### 21-2 电场与电势的关系

由电场求电势差：

$$
\boxed{\Delta V=-\int\vec E\cdot\mathrm d\vec l}.
$$

由电势求电场：

$$
\boxed{\vec E=-\nabla V}
$$

直角坐标下

$$
E_x=-\frac{\partial V}{\partial x},\qquad
E_y=-\frac{\partial V}{\partial y},\qquad
E_z=-\frac{\partial V}{\partial z}.
$$

如果场只沿 $x$ 方向变化且电场沿 $x$ 方向，则 $E_x=-\mathrm dV/\mathrm dx$。**负号**表示电场指向电势下降最快的方向。

### 21-3 电势的计算（Calculation of Electric Potential）

令 $V(\infty)=0$，点电荷 $Q$ 的电势：

$$
\boxed{V(r)=\frac{kQ}{r}}.
$$

点电荷系满足**标量叠加**，连续分布则用积分：

$$
\boxed{V(P)=\sum_i\frac{kQ_i}{r_i}},\qquad
\boxed{V(P)=k\int\frac{\mathrm dQ}{r}}.
$$

重要区别：计算 $\vec E$ 时对**矢量**分量积分；计算 $V$ 时直接对**标量**求和，往往更简单。

常见结果（$V(\infty)=0$）：

| 分布                                 | 电势                     |
| ------------------------------------ | ------------------------ |
| 球外的球对称带电体（总电荷 $Q$）     | $V(r)=kQ/r$，$r\ge R$    |
| 带总电荷 $Q$ 的导体球内部及表面      | $V(r)=kQ/R$，$r\le R$    |
| 均匀带电圆环的轴线上                 | $V(x)=kQ/\sqrt{x^2+R^2}$ |
| 均匀带电细棒轴向延长线、距近端 $a>0$ | $V=k\lambda\ln[(a+L)/a]$ |

### 21-5 等势面（Equipotential Surfaces）

- 等势面上各点 $V$ 相同，**沿等势面移动电荷，静电力做功为零**。
- 电场线处处垂直等势面；两者不能在同一点斜交。
- 在相同电势差的相邻等势面之间，距离越小意味着平均电场越强。
- 静电平衡的导体是等势体，其表面也是等势面。
- 对均匀电场，等势面为一组垂直于 $\vec E$ 的平行平面；点电荷的等势面是同心球面。

### 21-7 由电势求电场（$\vec E$ Determined from $V$）

梯度 $\nabla V$ 指向电势上升最快的方向，$\vec E=-\nabla V$ 指向下降最快的方向。处理三维函数时，**三个偏导数都要检查**；不能只对一个自变量求导便当作整个电场。

### 21 章典型例题与解题思路

#### 例题 21-1：电势差与静电力做功（对应课件第 9–10 页的电荷移动题）

![ch21-ex01](./_assets/physics/ch21-ex01.png)

**题目**：一点电荷 $Q$ 位于原点，将试探电荷 $q$ 从距原点 $r_a$ 的位置移动到 $r_b$。求静电力做功和电势能变化。

**思路**：库仑力是保守力，路径没有影响；先求两个端点的电势，再用 $W=q(V_a-V_b)$。

$$
V_a=\frac{kQ}{r_a},\qquad V_b=\frac{kQ}{r_b}.
$$

$$
\boxed{W_{a\to b}^{(\mathrm e)}=kQq\left(\frac1{r_a}-\frac1{r_b}\right)},
$$

$$
\boxed{\Delta U=kQq\left(\frac1{r_b}-\frac1{r_a}\right)=-W_{a\to b}^{(\mathrm e)}}.
$$

**判断正负**：若 $Qq>0$ 且 $r_b>r_a$，电场力做正功，电势能减小；如果有人施加外力并缓慢移动电荷，外力做功与此相反。

#### 例题 21-2：均匀带电导体球的电势（课件例 2，第 11–12 页）

![ch21-ex02](./_assets/physics/ch21-ex02.png)

**题目**：半径 $R$ 的孤立导体球带电 $Q$，求各处电势。

**思路**：由第 20 章，球内 $E=0$、球外 $E=kQ/r^2$；取无穷远为零点，对球外积分并利用导体等势性质。

$$
\boxed{V(r)=
\begin{cases}
\dfrac{kQ}{R},&0\le r\le R,\\[5pt]
\dfrac{kQ}{r},&r>R.
\end{cases}}
$$

**核心**：导体内虽 $E=0$，但 $V$ 一般**不为零**，而是一个常量。

#### 例题 21-3：均匀带电细棒的轴向电势（课件例 3，第 13 页）

![ch21-ex03](./_assets/physics/ch21-ex03.png)

**题目**：长度 $L$、线密度 $\lambda$ 的细棒，求延长线上距近端 $a>0$ 处的电势，零点在无穷远。

**思路**：从近端量起取电荷元 $\mathrm dQ=\lambda\,\mathrm dx$，到场点距离为 $a+x$；对标量 $\mathrm dV=k\mathrm dQ/(a+x)$ 积分。

$$
V=k\lambda\int_0^L\frac{\mathrm dx}{a+x}
=\boxed{k\lambda\ln\frac{a+L}{a}}.
$$

**检查**：$a\gg L$ 时，$\ln(1+L/a)\approx L/a$，于是 $V\approx k\lambda L/a=kQ/a$，与远处点电荷近似一致。

#### 例题 21-4：带电圆环轴线上的电势与电场（课件例 4，第 14 页）

![ch21-ex04](./_assets/physics/ch21-ex04.png)

**题目**：半径 $R$ 的薄圆环均匀带电 $Q$，求轴线上位置 $x$ 的电势，并由电势求电场。

**思路**：圆环上所有电荷元到轴线点的距离相同，可直接积分电势；然后用 $E_x=-\mathrm dV/\mathrm dx$。

$$
V(x)=k\int\frac{\mathrm dQ}{\sqrt{x^2+R^2}}
=\boxed{\frac{kQ}{\sqrt{x^2+R^2}}}.
$$

$$
E_x=-\frac{\mathrm dV}{\mathrm dx}
=\boxed{\frac{kQx}{(x^2+R^2)^{3/2}}}.
$$

这与第 19 章直接积分电场所得结论相同，构成**两种方法相互校验**。

#### 例题 21-5：已知电势函数求电场（对应课件例 5，第 28 页）

![ch21-ex05](./_assets/physics/ch21-ex05.png)

**题目（练习化改写）**：某区域电势为 $V(x,y,z)=Ax^2+Byz+C$，其中 $A,B,C$ 为常数，求 $\vec E$。

**思路**：逐项计算偏导，再整体加负号。

$$
\frac{\partial V}{\partial x}=2Ax,\qquad
\frac{\partial V}{\partial y}=Bz,\qquad
\frac{\partial V}{\partial z}=By.
$$

$$
\boxed{\vec E=-2Ax\hat x-Bz\hat y-By\hat z}.
$$

**注意**：常数 $C$ 不影响电场。此题的具体函数为便于练习而给出的**补充示例**，不是声称课件例 5 使用了同一函数。

#### 例题 21-6：均匀带电圆锥侧面顶点电势（课件第 15 页）

![ch21-ex06](./_assets/physics/ch21-ex06.png)

**题目**：高 $h$、底面半径 $R$ 的圆锥薄侧面均匀带面密度 $\sigma$，求顶点处电势（无穷远为零）。

**思路**：从锥顶沿母线取宽 $\mathrm ds$ 的环形带，设母线全长 $\ell=\sqrt{h^2+R^2}$。该环半径 $r=(R/\ell)s$，面积 $\mathrm dS=2\pi r\,\mathrm ds$；其到顶点距离为 $s$。

$$
V=k\int_0^\ell\frac{\sigma\,2\pi(R/\ell)s\,\mathrm ds}{s}
=2\pi k\sigma R.
$$

所以

$$
\boxed{V_{\mathrm{tip}}=\frac{\sigma R}{2\varepsilon_0}}.
$$

**特点**：在 $\sigma$ 与 $R$ 固定的条件下，结果不显含高度 $h$；注意这里只计算**圆锥侧面**上的电荷，不含底面。

---

## 第 22 章：电容、电介质与静电能（Capacitance, Dielectrics, Electric Energy Storage）

### 22-1 电容器与电容（Capacitors & Capacitance）

电容器由彼此绝缘的导体构成，用来存储等量异号电荷 $+Q$、$-Q$。电容定义：

$$
\boxed{C=\frac{Q}{\Delta V}},\qquad Q=C\Delta V.
$$

电容单位为法拉（F），常见有 $\mu\mathrm F$、$\mathrm{nF}$、$\mathrm{pF}$。

- 对给定几何构型和线性介质，$C$ 由**形状、尺寸、相对位置及介电性质**决定，不由当前 $Q$ 或 $\Delta V$ 决定。
- 电容器在理想情况下储存电荷和电场能量，不是凭空产生电荷的器件。
- 如果某电容器两端电压加倍且 $C$ 不变，则 $Q$ 加倍；这是课件第 6 页选择题的关键。

### 22-2 典型几何结构的电容（Determination of Capacitance）

**平行板电容器**（极板面积 $S$、板距 $d$、忽略边缘效应）：

$$
\boxed{C_0=\frac{\varepsilon_0S}{d}}.
$$

**长同轴圆柱形电容器**（内、外导体半径 $R_1<R_2$，长度 $L\gg R_2$，忽略端部效应）：

$$
\boxed{C=\frac{2\pi\varepsilon_0L}{\ln(R_2/R_1)}}.
$$

**同心球形电容器**（内、外导体半径 $R_1<R_2$）：

$$
\boxed{C=4\pi\varepsilon_0\frac{R_1R_2}{R_2-R_1}}.
$$

当外球半径 $R_2\to\infty$，孤立导体球电容为 $C=4\pi\varepsilon_0R_1$。若全部间隙充满均匀线性电介质，上述 $\varepsilon_0$ 可替换为材料的 $\varepsilon=\kappa\varepsilon_0$。

### 22-3 电容器的串联与并联（Series and Parallel）

| 连接方式                     | 不变量                                             | 等效电容                                                 |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| **串联**（理想、无其他支路） | 各电容器电荷量大小相同，$Q_1=Q_2=\cdots$；电压相加 | $\displaystyle\frac1{C_{\mathrm{eq}}}=\sum_i\frac1{C_i}$ |
| **并联**                     | 各电容器电压相同，$V_1=V_2=\cdots$；电荷量相加     | $\displaystyle C_{\mathrm{eq}}=\sum_iC_i$                |

- 串联等效电容小于其中任意一个电容；并联等效电容大于其中任意一个电容（正电容情形）。
- 判断网络连接时，**看节点而不是看图画位置**。两个元件连接同一对节点才是并联；串联的中间节点不能接入产生分流的其他支路。
- **接着电池**通常意味着总电压被固定；**断开电池且系统绝缘**通常意味着相关孤立导体的自由电荷保持不变。具体还要结合接线与哪些节点是孤立的判断。

### 22-4 电容器储能与电场能量密度（Electric Energy Storage）

将电荷逐渐从 $0$ 充至 $Q$，在某时刻电压为 $V=q/C$，外界所做可逆充电功成为静电能：

$$
U=\int_0^Q\frac{q}{C}\,\mathrm dq
=\boxed{\frac{Q^2}{2C}=\frac12QV=\frac12CV^2}.
$$

均匀介质中的电场能量密度：

$$
\boxed{u=\frac12\varepsilon E^2},
$$

真空中 $u=\frac12\varepsilon_0E^2$。对一般线性、各向同性的均匀电介质，亦可写成 $u=\tfrac12\vec E\cdot\vec D$。全空间场能为 $U=\int u\,\mathrm dV$。

**选公式的诀窍**：题目固定电荷时宜用 $U=Q^2/(2C)$；固定电压时宜用 $U=CV^2/2$。不要忽略电池是否连接。

### 22-5 电介质（Dielectrics）

电介质是放在极板间的绝缘物质，能产生**极化**。相对介电常数 $\kappa=\varepsilon/\varepsilon_0$，在线性均匀介质完全填满几何不变的电容器时：

$$
\boxed{C=\kappa C_0}.
$$

**两种边界条件**（完整填充、理想线性介质）：

| 量                   | 电池仍连接：$V$ 固定 | 电池断开且电荷无法流失：$Q$ 固定 |
| -------------------- | -------------------- | -------------------------------- |
| 电容 $C$             | 变为 $\kappa C_0$    | 变为 $\kappa C_0$                |
| 电荷 $Q$             | 变为 $\kappa Q_0$    | 不变                             |
| 电压 $V$             | 不变                 | 变为 $V_0/\kappa$                |
| 电场 $E$（几何固定） | 不变                 | 变为 $E_0/\kappa$                |
| 储能 $U$             | 变为 $\kappa U_0$    | 变为 $U_0/\kappa$                |

> **重要限定**：表中“接电池时 $E$ 不变”依赖理想平行板的 $E=V/d$、板距不变及忽略边缘效应；“断开时 $Q$ 固定”依赖电荷无泄漏且各电容与电源确实隔离。不能无条件推广到任意非均匀结构。

电介质还可以提高电容器的耐压能力，但**击穿场强**由具体材料决定，不能简单用 $\kappa$ 直接换算击穿电压。

### 22-6 电介质的分子图像（Molecular Description of Dielectrics）

- **极性分子**（课件举例：$\mathrm{H_2O}$、CO）：自身有永久电偶极矩；外场会使偶极矩倾向取向排列。
- **非极性分子**（课件举例：$\mathrm{O_2}$、$\mathrm{N_2}$）：无永久电偶极矩，外场使正负电荷中心发生相对位移，产生**诱导偶极矩**。
- **极化**：介质内部形成束缚电荷（polarization / bound charge），其诱导电场通常部分抵消外加场；这里说“部分抵消”指给定自由电荷时的情形，不表示介质中的电场处处为零。
- **现象联系**：带电物体能吸引碎纸屑或偏折细水流，与介质极化及非均匀电场作用相关；电容式触摸屏通过电容变化感知触摸。

### 22 章典型例题与解题思路

#### 例题 22-1：同轴圆柱形电容器（课件例 1，第 7 页）

![ch22-ex01](./_assets/physics/ch22-ex01.png)

**题目**：两同轴圆柱壳半径分别为 $R_1,R_2$（$R_1<R_2$），长度 $L\gg R_2$，内外导体携带 $+Q,-Q$，求电容。

**思路**：先用柱形高斯面求场，再积分两导体之间的电势差，最后 $C=Q/\Delta V$。

设单位长度带电量 $\lambda=Q/L$：

$$
E(r)=\frac{\lambda}{2\pi\varepsilon_0r},\qquad R_1<r<R_2.
$$

$$
\Delta V=V(R_1)-V(R_2)
=\int_{R_1}^{R_2}E(r)\,\mathrm dr
=\frac{Q}{2\pi\varepsilon_0L}\ln\frac{R_2}{R_1}.
$$

因此

$$
\boxed{C=\frac{2\pi\varepsilon_0L}{\ln(R_2/R_1)}}.
$$

#### 例题 22-2：同心球形电容器（课件第 8 页）

![ch22-ex02](./_assets/physics/ch22-ex02.png)

**题目**：内球半径 $R_1$、外球壳内半径 $R_2$，两导体净电荷分别为 $+Q,-Q$，求电容。

**思路**：球形高斯面给出两球之间 $E(r)=kQ/r^2$，对半径积分求电势差。

$$
\Delta V=\int_{R_1}^{R_2}\frac{kQ}{r^2}\,\mathrm dr
=kQ\left(\frac1{R_1}-\frac1{R_2}\right).
$$

$$
\boxed{C=\frac{Q}{\Delta V}=
4\pi\varepsilon_0\frac{R_1R_2}{R_2-R_1}}.
$$

**进一步**：令 $R_2\to\infty$，得到 $C=4\pi\varepsilon_0R_1$。

#### 例题 22-3：平行板电容器的数值计算与储能（课件例 4，第 13 页）

![ch22-ex03](./_assets/physics/ch22-ex03.png)

**题目**：平行板电容器板距 $d=1\,\mathrm{mm}$、板面积 $S=10\,\mathrm{cm^2}$，电压 $V=220\,\mathrm V$；忽略边缘效应，求电容和储能。

**思路**：先将单位换为 SI 制：$d=1.0\times10^{-3}\,\mathrm m$，$S=1.0\times10^{-3}\,\mathrm{m^2}$。再分别使用 $C=\varepsilon_0S/d$ 和 $U=CV^2/2$。

$$
\boxed{C=8.854\times10^{-12}\,\mathrm F\approx8.85\,\mathrm{pF}},
$$

$$
\boxed{U=\frac12(8.854\times10^{-12})(220)^2
\approx2.14\times10^{-7}\,\mathrm J}.
$$

**提示**：本题的 $220\,\mathrm V$ 是给定电压，并不表示对任何实际电容器都安全；最大可储能还受绝缘材料的击穿场强限制。

#### 例题 22-4：断电后给串联电容器之一填充介质（课件第 19 页选择题）

![ch22-ex04](./_assets/physics/ch22-ex04.png)

**题目**：两个空气电容器 $C_1,C_2$ 串联，充电后将电池断开，并保持所有电极与外界绝缘。向 $C_1$ 完全填入相对介电常数 $\kappa>1$ 的介质，两个电容器的端电压如何变化？

**思路**：隔离的串联组合中原有串联电荷量 $Q$ 不变。填介质后 $C_1'=\kappa C_1$，$C_2$ 不变。

$$
V_1'=\frac{Q}{\kappa C_1}=\frac{V_1}{\kappa},\qquad
V_2'=\frac{Q}{C_2}=V_2.
$$

**答案**：$C_1$ 的电压**减小**，$C_2$ 的电压**保持不变**；对应课件选择题中的第二种描述（B）。

#### 例题 22-5：平行板电容器“填充一半”介质（课件第 20 页）

![ch22-ex05](./_assets/physics/ch22-ex05.png)

**题目**：原平行板面积 $S$、板距 $d$、空气电容 $C_0=\varepsilon_0S/d$，用介电常数 $\kappa$ 的材料填充“一半”，求新电容。

**思路**：“填充一半”有两种**不同几何意义**，必须看图判断等效串并联。

**情形 A：占据一半极板面积，厚度贯穿整个板距**。两半区域电压相同，相当于并联：

$$
C=\frac{\kappa\varepsilon_0(S/2)}d+\frac{\varepsilon_0(S/2)}d
=\boxed{\frac{\kappa+1}{2}C_0}.
$$

**情形 B：占据一半板距，面积覆盖整个极板**。两层介质承受的电荷相同，相当于串联：

$$
\frac1C=\frac{d/2}{\kappa\varepsilon_0S}+\frac{d/2}{\varepsilon_0S}
\quad\Longrightarrow\quad
\boxed{C=\frac{2\kappa}{\kappa+1}C_0}.
$$

**易错点**：只写“半填充”无法决定答案；一定要区分**并排面积填充**和**沿场方向厚度填充**。

#### 例题 22-6：从带电电容器中抽出电介质，能量从哪里来？（课件第 23 页思考题）

![ch22-ex06](./_assets/physics/ch22-ex06.png)

**题目**：一只充电后的电容器已与电池断开，现将填入的电介质缓慢抽出。为什么电场能量可能增加？

**思路**：断电后 $Q$ 不变；抽出介质使电容 $C$ 减小，因此 $U=Q^2/(2C)$ 增大。增加的电场能来自**外力克服电场吸引电介质所做的机械功**。

$$
\Delta U=\frac{Q^2}{2}\left(\frac1{C_{\mathrm{after}}}-\frac1{C_{\mathrm{before}}}\right)>0.
$$

若电容器仍连接理想电池，电势差固定，必须同时考虑电池供能或吸能，不能仅比较 $\frac12CV^2$ 就当作全过程的机械功。

### 22 章课件末尾的扩展提示

课件末页提醒 **Chapter 23–24（Electric Current and Resistance）** 可自行预习，涉及电流、电流密度、电阻、欧姆定律、导电率和电阻率。这些内容可在后续章节中继续补充。

---

### 静电学知识联系与常见易错点（阶段复习）

**知识链**：

$$
\boxed{\text{电荷分布}\ \xrightarrow{\text{库仑定律/高斯定律}}\ \vec E
\ \xrightarrow{\,-\int\vec E\cdot\mathrm d\vec l\,}\ V
\ \xrightarrow{\,U=qV,\ C=Q/\Delta V\,}\ \text{电势能与电容}}
$$

反向求场则用 $\vec E=-\nabla V$。需要强调的是，高斯定律适合**高对称性**，并不是任意分布求场都比库仑积分简便。

| 易错认识                             | 正确判断                                                              |
| ------------------------------------ | --------------------------------------------------------------------- |
| 高斯面内净电荷为零，所以面上电场为零 | 仅能推知**净电通量为零**，电场仍可能非零                              |
| 导体内部电场为零，所以电势为零       | 导体内部**电势为常数**，不一定为零                                    |
| 电场与电势都是矢量                   | $\vec E$ 为矢量，$V$ 为标量                                           |
| 电场一定指向电势“数值更大”的方向     | 电场指向**电势降低**的方向                                            |
| 负电荷沿电场运动，电势能一定减小     | $\Delta U=q\Delta V$，对负电荷取向需仔细判断                          |
| 串联电容器电压相同                   | 串联一般**电荷量相同**；并联电压相同                                  |
| 电容随电荷和电压成比例变化           | 线性电容的 $C$ 由几何与材料决定，$Q$ 才随 $V$ 变化                    |
| 加电介质后电场和电荷总是减小         | 取决于**接电池（定电压）**还是**断开（定电荷）**                      |
| 题目说“填充一半”就能直接套唯一公式   | 必须区分**半面积并联**和**半厚度串联**                                |
| 非导体无限带电平面与导体表面公式相同 | 前者每侧 $\sigma/(2\varepsilon_0)$；后者紧外侧 $\sigma/\varepsilon_0$ |

### 复习自测（建议闭卷完成）

1. 已知两个点电荷的大小与位置，如何用矢量叠加确定空间一点的电场方向？
2. 为什么均匀带电圆环在圆心电场为零，但电势不一定为零？
3. 高斯定律如何分别求均匀带电球壳、实心球体、长圆柱内外的电场？
4. 为什么处于静电平衡的导体材料内部不能存在非零电场？
5. 已知 $V(x,y,z)$，如何求 $E_x,E_y,E_z$？
6. 电容器断开电池后插入介质，$C,Q,V,U$ 如何变化？若电池始终连接，哪些结果会改变？
7. 对球形电容器，如何分别用 $U=Q^2/(2C)$ 和 $U=\int\frac12\varepsilon_0E^2\,\mathrm dV$ 验证总能量一致？

**建议学习顺序**：先掌握库仑积分与电场方向 → 再训练高斯面的选取 → 然后熟练区分 $E,V,U$ → 最后练习电容器在**定 $Q$ / 定 $V$** 两种条件下的变化题。

### 原笔记静电学章节课件来源

| 文件                                  | 本笔记的主要内容                             | 课件中典型例题位置       |
| ------------------------------------- | -------------------------------------------- | ------------------------ |
| `Ch19 Electric Field.pptx`            | 电荷、库仑定律、电场、连续电荷分布、电偶极子 | 幻灯片 20、22–29、33     |
| `Ch20 Gauss's law.pptx`               | 电通量、高斯定律、对称电场、导体与静电屏蔽   | 幻灯片 12–17、19、22–23  |
| `Ch21 Electric potential.pptx`        | 静电势能、电势、电势计算、等势面、梯度       | 幻灯片 9–15、23–29       |
| `Ch22 Capacitance & Dielectrics.pptx` | 电容器、串并联、静电能、电介质、极化         | 幻灯片 7–8、13–15、19–23 |

> **说明**：目前已整理的章节以相应课件为主要依据；部分公式补充了推导，部分课堂互动题未收录。例题配图为依据题设重新绘制的示意图，而非课件原图；若课件的特定坐标、接线和介质方向与示意图表述有差异，应以题目原图和文字条件为准。
---

## 第 25 章：磁学基础（Magnetism）

> **课件主线**：磁场概念 → 电流受到的安培力 → 电流环的磁力矩与磁偶极矩 → 运动电荷的洛伦兹力 → 带电粒子运动和霍尔效应。以下定量推导是根据课件题型补充的学习步骤，图均为重绘示意图。

### 25-1 磁体、磁场和磁感线（Magnets and Magnetic Fields）

- 磁体通常表现出 N、S 两极：同名磁极相斥，异名相吸；**尚未发现孤立磁单极子**。
- 奥斯特实验表明**电流产生磁场**；安培的分子电流观点把宏观磁性和微观电流联系起来。
- 磁感线在常规电磁学中形成闭合曲线；某处磁感线切线为磁场方向，疏密定性代表磁场强弱。
- 磁感应强度记作 $\vec B$，SI 单位是特斯拉 $\mathrm T$。$1\,\mathrm T=1\,\mathrm{N/(A\,m)}$。

**方向表示**：$\odot$ 代表矢量从纸面向外，$\otimes$ 代表矢量进入纸面。右手定则通常针对**正电流**和正电荷；负电荷的磁力方向反向。

### 25-2 电流在磁场中的力（Ampère Force）

磁场对长度为 $\mathrm d\vec\ell$ 的载流导线微元的力：

$$
\boxed{\mathrm d\vec F=I\,\mathrm d\vec\ell\times\vec B},\qquad
\boxed{\vec F=I\int_C\mathrm d\vec\ell\times\vec B}.
$$

匀强磁场中的直导线：

$$
\boxed{\vec F=I\vec L\times\vec B},\qquad F=ILB\sin\theta.
$$

$\vec L$ 沿**常规电流方向**；$\theta$ 是导线方向与磁场的夹角。若 $\theta=0$ 或 $\pi$，磁力为零。

**课件例题 25-3 Example 1：弯曲导线为何可等效直线段？**

![均匀磁场中弯曲导线](./_assets/physics/ch25-ex01.png)

从 $A$ 连到 $B$ 的任意导线在恒定均匀磁场中：

$$
\vec F=I\int_A^B\mathrm d\vec\ell\times\vec B
=I\left(\int_A^B\mathrm d\vec\ell\right)\times\vec B
=\boxed{I\overrightarrow{AB}\times\vec B}.
$$

注意：**只有当 $\vec B$ 在积分区域内恒定**时，才能提出积分号外。闭合电流环在匀强磁场中的**合力为零**，但磁力矩不一定为零。

### 25-3 电流环的磁力矩与磁偶极矩（Magnetic Dipole Moment）

面积为 $A$ 的平面电流环，法向量 $\hat n$ 根据电流方向用右手定则确定，定义

$$
\boxed{\vec\mu=IA\hat n}\quad (N\text{ 匝则 }\vec\mu=NIA\hat n).
$$

在匀强磁场中：

$$
\boxed{\vec\tau=\vec\mu\times\vec B},\qquad
\tau=\mu B\sin\theta,\qquad U=-\vec\mu\cdot\vec B.
$$

- $\vec\mu$ 与 $\vec B$ 平行：$U$ 最小，稳定平衡；反平行：$U$ 最大，不稳定平衡。
- 磁偶极矩的单位是 $\mathrm{A\,m^2}$，也可写 $\mathrm{J/T}$；电偶极矩 $\vec p=q\vec d$ 与其定义、单位不同。
- 对于非均匀磁场，小磁偶极子还可能受到合力；上式“合力为零”仅针对**均匀磁场**。

**课件 Example 3：轨道电子磁矩与角动量**。经典圆轨道模型中，电子电量 $-e$，绕核运动速度 $v$、轨道半径 $r$：

$$
I=\frac{-e}{T}=\frac{-ev}{2\pi r},\quad
\vec\mu=IA\hat n=-\frac{evr}{2}\hat n,
\quad \vec L=m_evr\hat n.
$$

因此

$$
\boxed{\vec\mu=-\frac{e}{2m_e}\vec L}.
$$

**负号重要**：电子带负电，轨道磁矩与轨道角动量反向。这一结果是经典轨道模型的推导，不能把现代原子电子视为真正沿固定圆轨道运动。

**课件 Example 4：均匀带电圆盘转动的磁偶极矩**。总电荷 $Q$ 均匀分布在半径 $R$ 的薄圆盘上，以角速度 $\omega$ 转动。

取半径为 $r$、宽 $\mathrm dr$ 的环带：

$$
\mathrm dQ=\sigma 2\pi r\,\mathrm dr,\qquad
\mathrm dI=\frac{\omega}{2\pi}\mathrm dQ=\sigma\omega r\,\mathrm dr.
$$

$$
\mu=\int_0^R(\pi r^2)\,\mathrm dI
=\pi\sigma\omega\int_0^Rr^3\,\mathrm dr
=\boxed{\frac{Q\omega R^2}{4}}.
$$

若 $Q>0$，$\vec\mu$ 与 $\vec\omega$ 同向；若 $Q<0$，反向。

### 25-4 运动电荷的磁力（Lorentz Force）

$$
\boxed{\vec F_B=q\vec v\times\vec B},\quad |F_B|=|q|vB\sin\theta,
\qquad\boxed{\vec F=q(\vec E+\vec v\times\vec B)}.
$$

磁力始终垂直于电荷的瞬时速度，因而 $\vec F_B\cdot\vec v=0$：**单纯磁场力不做功、不改变速率，只改变速度方向**。若同时有电场，电场可做功。

**匀强磁场中的轨迹**：把速度分解为平行分量 $v_\parallel$ 与垂直分量 $v_\perp$。

| 入射情形 | 运动类型 | 结论 |
| --- | --- | --- |
| $v\parallel B$ | 沿场方向匀速直线 | $F_B=0$ |
| $v\perp B$ | 匀速圆周运动 | $r=\dfrac{mv_\perp}{|q|B}$，$T=\dfrac{2\pi m}{|q|B}$ |
| 倾斜入射 | 螺旋运动（Helix） | 螺距 $h=v_\parallel T$ |

![磁场中带电粒子运动](./_assets/physics/ch25-ex02.png)

**圆周运动推导**：洛伦兹力提供向心力，$|q|v_\perp B=mv_\perp^2/r$。求角速度 $\omega_c=|q|B/m$，故回旋周期不依赖于速率（**非相对论条件**）。

**课件互动题**：两个同质量、同电荷的粒子垂直进入同一磁场，后者速度更大。由于 $r\propto v_\perp$，后者圆轨道半径**更大**。

### 25-5 霍尔效应（Hall Effect）

电流密度为 $\vec J$ 的导体置于垂直磁场中，载流子受磁偏转，在两侧形成横向电场。当达到平衡：

$$
q\vec E_H+q\vec v_d\times\vec B=0.
$$

若样品厚度（沿磁场方向）为 $t$，载流子数密度为 $n$、单个载流子电荷为 $q$，按约定方向写出的**有符号**霍尔系数为

$$
\boxed{R_H=\frac{1}{nq}},\qquad
\boxed{V_H=R_H\frac{IB}{t}}.
$$

测量 $V_H$ 的正负（给定电流、磁场、引线方向）可判断主要载流子符号；仅套绝对值公式 $|V_H|=IB/(n|q|t)$ 无法判断极性。该式是单一类型载流子的简单模型，多载流子体系会更复杂。

### 第 25 章易错点与自测

- 磁力用**叉积**，不能把 $\sin\theta$ 漏掉；带负电粒子方向与右手结果相反。
- $\vec\mu$ 沿**线圈法线**，不是沿导线；电流环合力为零不代表力矩为零。
- 圆轨道半径中的速度是 $v_\perp$，螺距用 $v_\parallel$。
- **自测**：为什么均匀磁场中的闭合环合力为零但可转动？电子轨道磁矩为何反向于角动量？霍尔电压如何区别正负载流子？

---

## 第 26 章：磁场的来源（Sources of Magnetic Field）

> **课件主线**：毕奥–萨伐尔定律 → 直导线和圆形线圈的磁场 → 平行电流的相互作用 → 磁通量、磁场高斯定律、安培环路定律 → 长螺线管与环形螺线管 → 物质的磁性。

### 26-1 毕奥–萨伐尔定律（Biot–Savart Law）

稳恒电流微元 $I\,\mathrm d\vec\ell$ 在场点 $P$ 产生的微小磁场为

$$
\boxed{\mathrm d\vec B=\frac{\mu_0}{4\pi}\frac{I\,\mathrm d\vec\ell\times\hat{\boldsymbol r}}{r^2}}
=\frac{\mu_0I}{4\pi}\frac{\mathrm d\vec\ell\times\vec r}{r^3}.
$$

其中 $\vec r$ **从电流元指向场点**，$\mu_0$ 为真空磁导率（基础题常取 $4\pi\times10^{-7}\,\mathrm{H/m}$ 的近似值）。取大小得到

$$
\mathrm dB=\frac{\mu_0}{4\pi}\frac{I\,\mathrm d\ell\sin\theta}{r^2},\qquad \vec B=\int\mathrm d\vec B.
$$

**为何要乘 $\sin\theta$？** 因为电流方向与指向场点的矢量夹角为 $\theta$，叉积只保留与这两个向量垂直的部分，沿电流方向延长线上的微元贡献为零。

### 26-2 有限长与无限长直导线（Magnetic Field of a Straight Wire）

![直导线场点的几何](./_assets/physics/ch26-ex01.png)

让直导线沿 $x$ 轴，场点 $P$ 到导线的垂距为 $a$，电流元坐标为 $x$：

$$
\mathrm dB=\frac{\mu_0I}{4\pi}\frac{a\,\mathrm dx}{(a^2+x^2)^{3/2}}.
$$

若导线覆盖 $x_1$ 至 $x_2$，积分得

$$
B=\frac{\mu_0I}{4\pi a}
\left[\frac{x}{\sqrt{x^2+a^2}}\right]_{x_1}^{x_2}
=\frac{\mu_0I}{4\pi a}(\sin\theta_2-\sin\theta_1),
$$

这里 $\theta_i=\arctan(x_i/a)$ 是**带符号角**，从场点垂线起量。若两端分别位于垂足两侧，也常写成 $\mu_0I(\sin\alpha+\sin\beta)/(4\pi a)$（$\alpha,\beta$ 为两侧的正角）。

**无限长极限**：$x_1\to-\infty,x_2\to+\infty$，

$$
\boxed{B(r)=\frac{\mu_0I}{2\pi r}}.
$$

场点落在一段直导线的同一条延长线上时，$\mathrm d\vec\ell\parallel\vec r$，该**直线段自身**对该点的场为零；不可因此推断其他弯曲导线或整个电路的场也为零。

### 26-3 平行电流之间的力（Force between Parallel Wires）

相距 $d$ 的两根长直导线，分别通电流 $I_1,I_2$：

$$
B_1=\frac{\mu_0I_1}{2\pi d},\qquad
\boxed{\frac FL=\frac{\mu_0|I_1I_2|}{2\pi d}}.
$$

同向电流**相吸**，反向电流**相斥**。

**课件互动题：三根间距相等的导线**。从左向右 $1\,\mathrm A,2\,\mathrm A,3\,\mathrm A$ 均同向，相邻距 $d$。

以 $K=\mu_0/(2\pi d)$ 表示公因子，导线 I 受到向右吸引：

$$
F_1/L=K(1\cdot2+1\cdot3/2)=3.5K.
$$

导线 II 左右两侧吸引力反向：

$$
F_2/L=K(2\cdot3-2\cdot1)=4K,
\qquad\boxed{F_1/F_2=7/8}.
$$

该题必须考虑**方向抵消**，不能把导线 II 两侧力大小简单相加。

### 26-4 圆形电流及磁偶极子轴线磁场（Circular Current）

半径 $R$ 的圆形线圈载电流 $I$，轴线上离圆心 $x$ 处的场。利用毕奥–萨伐尔定律与对称性，所有线元贡献的**横向分量互相抵消**，只剩轴向：

$$
\boxed{B_x(x)=\frac{\mu_0IR^2}{2(R^2+x^2)^{3/2}}}.
$$

![环形线圈轴线磁场](./_assets/physics/ch26-ex02.png)

**推导要点**：线元到场点距离 $r=\sqrt{R^2+x^2}$，由于 $\mathrm d\vec\ell\perp\vec r$，$\mathrm dB=\mu_0I\,\mathrm d\ell/(4\pi r^2)$；在轴线方向的投影因子为 $R/r$，故

$$
B_x=\frac{\mu_0I}{4\pi}\frac{R}{r^3}\oint\mathrm d\ell
=\frac{\mu_0IR^2}{2r^3}.
$$

结果与极限：

- 圆心：$\boxed{B(0)=\mu_0I/(2R)}$，$N$ 匝乘以 $N$。
- 圆弧圆心：$\boxed{B=\mu_0I\varphi/(4\pi R)}$，$\varphi$ 为弧度角；径向直导线对圆心无贡献。
- 远场：$B\approx \mu_0\mu/(2\pi x^3)$（$x\gg R$，$\mu=I\pi R^2$）。

**课件旋转带电圆环**：总电荷 $Q$、半径 $R$，以角速度 $\omega$ 转动，等效电流 $I=Q\omega/(2\pi)$，圆心磁场

$$
\boxed{B(0)=\frac{\mu_0Q\omega}{4\pi R}}.
$$

该表达式含有符号，实际方向由电荷符号和旋转方向共同确定。

### 26-5 磁通量与磁场高斯定律（Gauss's Law for Magnetism）

$$
\boxed{\Phi_B=\int_S\vec B\cdot\mathrm d\vec A},\qquad
\boxed{\oint_{\partial V}\vec B\cdot\mathrm d\vec A=0}.
$$

磁通量单位 $\mathrm{Wb}=\mathrm{T\,m^2}$。对平面、匀强场 $\Phi_B=BA\cos\theta$；$\theta$ 是**场与面法线**的夹角，而不是场与平面的夹角。

**半球面通量技巧（对应课件互动题）**：半球曲面与底面构成闭合面，所以

$$
\Phi_{\rm curved}=-\Phi_{\rm base}.
$$

只需计算底面投影通量，必须根据图中的外法线判定正负；不要直接把曲面面积 $2\pi R^2$ 乘以 $B$。

### 26-6 安培环路定律（Ampère's Circuital Law）

稳恒电流场满足

$$
\boxed{\oint_C\vec B\cdot\mathrm d\vec\ell=\mu_0 I_{\rm enc}}.
$$

$I_{\rm enc}$ 是**穿过选定有向曲面**的代数电流：右手四指沿积分方向，拇指所指为正穿出方向。环路的环量只与穿面净电流有关，但**某一点的磁场由所有电流共同产生**。

使用安培定律**计算 $B$** 需足够对称，使所选环路上 $B$ 恒定、切向或为零。一般非对称几何不能随意写 $B\cdot 2\pi r=\mu_0 I_{\rm enc}$。

**课件 Example 4：电流均匀分布于半径 $R$ 的长圆柱导体**：

$$
I_{\rm enc}(r)=I\frac{r^2}{R^2}\quad(r<R).
$$

因圆柱对称，

$$
\boxed{B(r)=\begin{cases}
\dfrac{\mu_0 Ir}{2\pi R^2},&0\le r<R,\\[6pt]
\dfrac{\mu_0 I}{2\pi r},&r\ge R.
\end{cases}}
$$

**扩展：径向矩形面的磁通量**。矩形沿导线轴向长 $\ell$，径向从 $r=R$ 延伸至 $2R$，其面法线与 $\vec B$ 平行，则

$$
\Phi_B=\int_R^{2R}B(r)\ell\,\mathrm dr
=\boxed{\frac{\mu_0I\ell}{2\pi}\ln 2}.
$$

**长螺线管与环形螺线管**：

| 结构 | 磁场公式 | 适用说明 |
| --- | --- | --- |
| 理想长螺线管（Solenoid） | $B\approx\mu_0nI$，$n=N/L$ | 内部近似匀强；远离端部，外部近似零 |
| 理想环形螺线管（Toroid） | $B(r)=\mu_0NI/(2\pi r)$ | 铁芯截面环形区域内；理想化外部为零 |
| 无限长直导线 | $B(r)=\mu_0I/(2\pi r)$ | 环向磁场 |

### 26-7 磁性材料（Ferromagnetism, Paramagnetism, Diamagnetism）

- **铁磁性**：磁畴与磁滞回线（Hysteresis），有剩磁 $B_r$、矫顽力 $H_c$；软磁材料适合反复磁化，硬磁材料适合保持磁化。
- **顺磁性**：弱吸引外磁场，常有 $\chi_m>0$。
- **抗磁性**：弱排斥外磁场，通常 $\chi_m<0$。
- 简单线性各向同性材料中 $\vec B=\mu\vec H=\mu_0(1+\chi_m)\vec H$；铁磁体一般具有非线性和磁滞，不能全程使用单一常数 $\mu$。

### 第 26 章解题检查

优先判断：**电流元方向、场点矢量方向、可否用对称性、积分区域/安培环路、磁通量面的法向**。毕奥–萨伐尔适用于较一般稳恒电流计算；安培定律更适合强对称体系。

---

## 第 27 章：电磁感应与法拉第定律（Electromagnetic Induction）

> **课件主线**：磁通变化产生感应电动势 → 楞次定律 → 动生电动势（包括转动导体棒和电源驱动滑棒）→ 变化磁场产生涡旋电场；最后介绍发电机、变压器、涡流等应用。

### 27-1 感应电动势（Induced EMF）

电动势（Electromotive Force, EMF）虽然名字含“力”，但单位是**伏特**，表示非静电作用沿回路单位电荷所做的功：$\mathcal E=W_{\rm non-elec}/q$。**有感应电动势未必有电流**：导体回路断开仍可有电动势，闭合后才可能出现感应电流。

磁通量改变的来源通常分为：$B$ 随时间改变、回路面积改变、回路方向改变（或多者并存）。

### 27-2 法拉第定律与楞次定律（Faraday's and Lenz's Laws）

规定回路正方向与面积法线满足右手定则，则单匝线圈

$$
\boxed{\mathcal E=-\frac{\mathrm d\Phi_B}{\mathrm dt}},
\qquad \boxed{\mathcal E_N=-N\frac{\mathrm d\Phi_B}{\mathrm dt}}
$$

（$N$ 匝中的 $\Phi_B$ 指**每匝**相同磁通）。负号体现**楞次定律**：感应电流产生的磁场总是阻碍**原有磁通的变化**，而不是无条件抵消原磁场。

**方向判断四步**：确定穿过回路的磁通方向 → 判断其增加还是减少 → 设想感应磁场为阻碍这一变化的方向 → 用右手定则给出电流方向。

**课件 Example 1：旋转线圈**。面积 $A$、匝数 $N$ 的线圈以角速度 $\omega$ 在均匀磁场 $B$ 中旋转，法线与场夹角 $\theta=\omega t+\phi_0$：

$$
\Phi_B=BA\cos(\omega t+\phi_0),\qquad
\boxed{\mathcal E(t)=NBA\omega\sin(\omega t+\phi_0)}.
$$

峰值 $\mathcal E_0=NBA\omega$。在保持 $N,B,A,\omega$ 不变时，单纯降低线圈**电阻**不会增大**感应电动势**，但会改变负载电流（对应课件互动题）。

### 27-3 动生电动势（Motional EMF）

![运动导体棒切割磁感线](./_assets/physics/ch27-ex01.png)

导体整体以速度 $\vec v$ 在磁场中运动，自由电荷受到 $q\vec v\times\vec B$，发生电荷分离，在杆两端形成电压。一般表达式为

$$
\boxed{\mathcal E=\int_{a}^{b}(\vec v\times\vec B)\cdot\mathrm d\vec\ell}.
$$

长度为 $\ell$ 的直杆与速度、匀强磁场互相垂直：

$$
\boxed{|\mathcal E|=B\ell v}.
$$

**由面积变化验证**：导体棒在导轨上移动 $\mathrm dx=v\,\mathrm dt$，回路面积变化 $\mathrm dA=\ell v\,\mathrm dt$，故 $|\mathcal E|=|\mathrm d(BA)/\mathrm dt|=B\ell v$。两种推导描述同一现象。

**课件 Example 3：旋转导体棒**。长度 $L$ 的导体棒绕一端以角速度 $\omega$ 在垂直磁场 $B$ 中旋转，杆上距轴 $r$ 的点速度 $v(r)=\omega r$：

$$
\mathrm d\mathcal E=B\omega r\,\mathrm dr,\quad
\boxed{|\mathcal E|=\int_0^LB\omega r\,\mathrm dr=\frac12B\omega L^2}.
$$

**课件 Example 4：电源驱动的无摩擦滑棒**。质量 $m$、长 $\ell$ 的杆在匀强磁场 $B$ 中滑动，电路总电阻 $R$，电源恒定电动势 $\mathcal E_0$，忽略自感。

- **恒定电流 $I$**（理想恒流源）：$F=IB\ell$，故 $a=IB\ell/m$ 恒定、$v=v_0+at$（忽略额外阻力）。
- **恒定电动势 $\mathcal E_0$**：运动产生**反向动生电动势** $B\ell v$，电流随着速度增大而减小：

$$
I(t)=\frac{\mathcal E_0-B\ell v(t)}R,\qquad
m\frac{\mathrm dv}{\mathrm dt}=\frac{B\ell}{R}(\mathcal E_0-B\ell v).
$$

将其整理为

$$
\frac{\mathrm dv}{\mathrm dt}+\frac{B^2\ell^2}{mR}v
=\frac{B\ell\mathcal E_0}{mR}.
$$

若初始 $v(0)=0$，积分（解一阶微分方程）可得

$$
\boxed{v(t)=\frac{\mathcal E_0}{B\ell}\left(1-e^{-t/\tau}\right)},
\qquad \boxed{\tau=\frac{mR}{B^2\ell^2}}.
$$

**终端速度**为 $v_\infty=\mathcal E_0/(B\ell)$。此时杆上**反电动势**等于电源电动势，净电流趋零，因而加速度趋零。**为什么仍需积分？** 终端平衡只能给出最后的速度，积分才描述从静止到终速的**时间过程**。

**能量辨析**：洛伦兹磁力对单个带电粒子总功率仍为 $q(\vec v\times\vec B)\cdot\vec v=0$；宏观机械能转换涉及外力、电源和电场做功的分配，不能认为“磁场直接对电荷做功”。

### 27-4 变化磁场产生涡旋电场（Induced Electric Field）

即使空间没有导线，随时间变化的磁场也能产生**非保守的感应电场**。沿固定空间回路的积分形式为

$$
\boxed{\oint_C\vec E_{\rm ind}\cdot\mathrm d\vec\ell
=-\frac{\mathrm d}{\mathrm dt}\int_S\vec B\cdot\mathrm d\vec A}.
$$

这与静电场 $\oint\vec E_{\rm electrostatic}\cdot\mathrm d\vec\ell=0$ 不同：感生电场线可形成闭合曲线，不能一般地以单值静电势描述。

**课件 Example 5：半径 $R$ 的圆柱形区域内均匀磁场 $B(t)$ 垂直纸面变化**。在同心半径 $r$ 的圆周上，感应电场环向且大小恒定。由法拉第定律：

$$
E_\varphi 2\pi r=-\frac{\mathrm d\Phi_B}{\mathrm dt}.
$$

故按约定环向符号，

$$
\boxed{E_\varphi(r)=\begin{cases}
-\dfrac r2\dfrac{\mathrm dB}{\mathrm dt},&r\le R,\\[6pt]
-\dfrac{R^2}{2r}\dfrac{\mathrm dB}{\mathrm dt},&r>R.
\end{cases}}
$$

**关键**：当 $r>R$ 时，磁通量仅来自半径 $R$ 内有磁场的区域，不能用 $\pi r^2$ 作磁通面积；虽然外区 $B$ 可能为零，但感应电场不一定为零。

### 27-5 应用与易错点

- 发电机：机械运动造成磁通变化；变压器：交变磁通在另一绕组产生电动势；涡流：可导致感应加热和电磁阻尼。
- 感生电动势由 $\partial B/\partial t$ 相关的涡旋电场产生；动生电动势由导体运动中 $\vec v\times\vec B$ 作用产生。两种机制可同时存在。
- 法拉第定律的**负号是方向关系**；要求大小时可使用 $|\mathrm d\Phi/\mathrm dt|$，但随后仍需楞次定律判方向。
- **自测**：如果滑棒终速时无电流，为什么从静止到终速必须解微分方程？半径 $r>R$ 的环路为什么仍有感生电场？

---

## 第 28 章：电感与磁场能量（Inductance; Magnetic Energy Storage）

> **课件主线**：自感系数和自感电动势 → 互感及耦合线圈 → 磁场储能与能量密度 → 延伸到 LR/LC 电路。课件中带星号的小节作为扩展。

### 28-1 自感（Self-Inductance）

线性电感器每一匝的磁通为 $\Phi_B$，总磁通链 $\Lambda=N\Phi_B$ 与回路电流成正比：

$$
\boxed{L=\frac{\Lambda}{I}=\frac{N\Phi_B}{I}},\qquad
\boxed{\mathcal E_L=-L\frac{\mathrm dI}{\mathrm dt}}
$$

这里后一式假定 $L$ 恒定。电感单位为亨利，$1\,\mathrm H=1\,\mathrm{Wb/A}=1\,\mathrm{V\,s/A}$。自感电动势**阻碍电流变化**，不是“总与电流反向”：电流减小时它倾向于维持原电流方向。

**长螺线管自感推导**：长度 $\ell$、匝数 $N$、截面积 $A$，理想真空长螺线管 $B\approx\mu_0 NI/\ell$，故

$$
N\Phi_B=NBA=\frac{\mu_0N^2AI}{\ell}
\quad\Longrightarrow\quad
\boxed{L\approx\frac{\mu_0N^2A}{\ell}}.
$$

填充线性均匀磁芯时，可在近似条件下将 $\mu_0$ 替换为 $\mu$。

**课件 Example 1：薄壁同轴电缆单位长度自感**。同轴内外薄导体半径 $a<b$，流等大反向电流 $I$，忽略导体内磁场，只有间隙 $a<r<b$：

$$
B(r)=\frac{\mu_0I}{2\pi r},\qquad
\frac{\Phi_B}{\ell}=\int_a^b B(r)\,\mathrm dr
=\frac{\mu_0I}{2\pi}\ln\frac ba.
$$

因此

$$
\boxed{\frac L\ell=\frac{\mu_0}{2\pi}\ln\frac ba}.
$$

这是**薄壁理想模型的外部自感**，实际实心导线可另有内部自感。

**课件环形线圈题（环面矩形截面）**：内半径 $a$、外半径 $b$、高度 $h$、匝数 $N$：

$$
B(r)=\frac{\mu_0NI}{2\pi r},\qquad
\Phi_B=\int_a^bB(r)h\,\mathrm dr,
$$

$$
\boxed{L=\frac{\mu_0N^2h}{2\pi}\ln\frac ba}.
$$

### 28-2 互感（Mutual Inductance）

线圈 1 的电流 $I_1$ 产生穿过线圈 2 的磁通链 $\Lambda_{21}$，定义

$$
\boxed{M_{21}=\frac{\Lambda_{21}}{I_1}},\qquad
\boxed{\mathcal E_2=-M_{21}\frac{\mathrm dI_1}{\mathrm dt}}.
$$

对于线性、静态、互易的普通磁介质：$M_{12}=M_{21}=M$。互感同样以亨利为单位，其大小取决于线圈几何、距离、方向和磁芯。

**课件 Example 2：长直导线与方形线圈**。一个边长为 $a$ 的正方形线圈与无限长直导线同处平面，靠近直导线的边距为 $d$，两边平行于直导线。导线电流 $I$：

$$
\Phi_{21}=\int_d^{d+a}\frac{\mu_0I}{2\pi r}\,a\,\mathrm dr
=\frac{\mu_0Ia}{2\pi}\ln\frac{d+a}{d}.
$$

$$
\boxed{M=\frac{\mu_0a}{2\pi}\ln\frac{d+a}{d}}.
$$

若方形线圈中的电流随时间变化，直导线所在的**闭合回路**中感应电动势与实际回路构形、所穿磁通有关；不能把孤立的无限长开路直导线当作已定义好总电动势的回路。

**课件 Example 3：两个理想耦合线圈**。定义耦合系数 $k$：

$$
\boxed{|M|=k\sqrt{L_1L_2}},\qquad 0\le k\le1.
$$

理想完全耦合 $k=1$。串联同名端助磁、反向消磁时（符号与端点连接方向一致）：

$$
\boxed{L_{\rm eq}=L_1+L_2\pm2M}.
$$

### 28-3 电感器储能与磁能密度（Energy Stored in a Magnetic Field）

建立电流时电源克服反自感电动势做功。忽略电阻的情况下，电源供给电感的瞬时功率：

$$
P_L=\left(L\frac{\mathrm dI}{\mathrm dt}\right)I
=\frac{\mathrm d}{\mathrm dt}\left(\frac12LI^2\right).
$$

积分从 $0$ 到 $I$：

$$
\boxed{U_B=\frac12LI^2}.
$$

对线性各向同性介质，磁能密度

$$
\boxed{u_B=\frac12\vec B\cdot\vec H}
\quad\text{（真空中 }\boxed{u_B=\frac{B^2}{2\mu_0}}\text{）}.
$$

**检验长螺线管**：$U=\frac12 (\mu_0N^2A/\ell)I^2$；用内部均匀 $B=\mu_0NI/\ell$，算 $u_B(A\ell)=B^2A\ell/(2\mu_0)$，结果完全相同。

**两个互感线圈的总磁能**：

$$
\boxed{U=\frac12L_1I_1^2+\frac12L_2I_2^2\pm MI_1I_2}.
$$

正负号取决于选定电流的相对参考方向。为使磁能非负，须有 $M^2\le L_1L_2$，这也是耦合系数不超过 1 的来源。

### 28-4 LR 暂态（选学；LR Circuits）

![RL 电流增长曲线](./_assets/physics/ch28-ex01.png)

串联 $R,L$ 接通恒定直流电源 $\mathcal E$，从 $I(0)=0$ 开始：

$$
L\frac{\mathrm dI}{\mathrm dt}+RI=\mathcal E,\qquad
\boxed{I(t)=\frac{\mathcal E}{R}\left(1-e^{-t/\tau}\right)},
\quad \boxed{\tau=\frac LR}.
$$

断开电源并保持由电阻和电感组成的闭合放电回路：$I(t)=I_0e^{-t/\tau}$。$\tau$ 称时间常数，表征电流变化快慢。

### 28-5 LC 电磁振荡（选学；LC Oscillations）

理想无电阻 LC 回路，电荷 $q(t)$ 满足

$$
L\frac{\mathrm d^2q}{\mathrm dt^2}+\frac qC=0,\qquad
\boxed{\omega_0=\frac1{\sqrt{LC}}},\quad T=2\pi\sqrt{LC}.
$$

电能 $q^2/(2C)$ 与磁能 $LI^2/2$ 周期性交换，总和守恒。存在电阻时振荡会阻尼，不能直接套“能量永远保持不变”。

### 第 28 章易错点

- $L$ 是磁通**链**与电流的比例，$N$ 匝不要漏掉 $N$；长螺线管 $L\propto N^2$。
- 互感电动势来源是**另一个线圈的电流变化**，自感电动势来源是**自身电流变化**。
- 写 $u_B=B^2/(2\mu_0)$ 时须确保在真空或相应简化材料假设下使用。
- **自测**：自感为什么会抵抗电流突变？同轴电缆为什么要对 $1/r$ 积分得到对数？RL 暂态与第 27 章滑棒速度的一阶微分方程有何共同结构？


---

## 第 29 章：麦克斯韦方程组与电磁波（Maxwell's Equations and EM Waves）

> **课件主线**：变化电场产生磁场（位移电流）→ 安培–麦克斯韦定律 → 四个麦克斯韦方程 → 电磁波的产生、传播、能量及辐射压。注意与第 27 章“变化磁场产生电场”构成对照。

### 29-1 变化电场与位移电流（Displacement Current）

**为什么静磁场的安培定律需要修正？** 对正在充电的电容器，闭合环路 $C$ 所张的曲面 $S_1$ 可以穿过导线，包围传导电流 $I$；也可将曲面鼓起穿过两极板间的空隙 $S_2$，那里没有跨越间隙的自由电荷传导电流。若只写 $\oint\vec B\cdot\mathrm d\vec\ell=\mu_0I_{\rm conduction,enc}$，两种跨同一边界的曲面将给出矛盾结果。

![电容器充电中的位移电流](./_assets/physics/ch29-ex01.png)

麦克斯韦引入与电通量变化有关的**位移电流**：

$$
\boxed{I_d=\varepsilon_0\frac{\mathrm d\Phi_E}{\mathrm dt}},\qquad
\boxed{\Phi_E=\int_S\vec E\cdot\mathrm d\vec A}.
$$

对理想平行板真空电容器，忽略边缘效应：$E=Q/(\varepsilon_0A)$，$\Phi_E=EA=Q/\varepsilon_0$，因此

$$
I_d=\varepsilon_0\frac{\mathrm d}{\mathrm dt}\frac{Q}{\varepsilon_0}
=\frac{\mathrm dQ}{\mathrm dt}=I.
$$

**关键辨析**：在理想电容器的真空间隙里，位移电流**不是自由载流子跨越间隙**；它用变化电场在安培定律中产生磁场的作用来表征。电介质内部可以同时涉及极化电流，基础课此处以真空模型为准。

### 29-2 广义安培环路定律（Ampère–Maxwell Law）

积分形式：

$$
\boxed{\oint_C\vec B\cdot\mathrm d\vec\ell
=\mu_0I_{\rm conduction,enc}
+\mu_0\varepsilon_0\frac{\mathrm d\Phi_E}{\mathrm dt}}.
$$

因此即使没有穿面传导电流，只要该曲面的电通量变化，就可以有磁场环量。

**课件 Example 1：充电平行板电容器磁场**。半径为 $R$ 的圆形极板，电流 $I$ 恒定，取在极板间、距轴线 $r$ 的圆环路，假设 $E$ 在极板覆盖范围内均匀且忽略边缘场。

对 $r<R$，环路围住的电通量变化为总量的 $r^2/R^2$，所以

$$
B(2\pi r)=\mu_0I\frac{r^2}{R^2}
\quad\Longrightarrow\quad
\boxed{B(r)=\frac{\mu_0Ir}{2\pi R^2}\ (r<R)}.
$$

对 $r\ge R$：

$$
\boxed{B(r)=\frac{\mu_0I}{2\pi r}\ (r\ge R)}.
$$

这与第 26 章均匀载流圆柱的分段形式相似，但**磁场源机制不同**：一个是极板间变化电场，一个是导体内传导电流。

### 29-3 麦克斯韦方程组（Maxwell's Equations）

课件中将全部宏观电磁现象归纳为四个方程。下面先写**真空微观形式**（$\rho$ 为电荷密度，$\vec J$ 为传导电流密度），再对照物理意义：

| 名称 | 积分形式 | 微分形式 | 核心物理意义 |
| --- | --- | --- | --- |
| 电场高斯定律 | $\displaystyle\oint_S\vec E\cdot\mathrm d\vec A=Q_{\rm enc}/\varepsilon_0$ | $\nabla\cdot\vec E=\rho/\varepsilon_0$ | 电荷产生电场散度 |
| 磁场高斯定律 | $\displaystyle\oint_S\vec B\cdot\mathrm d\vec A=0$ | $\nabla\cdot\vec B=0$ | 没有观测到磁单极子；磁场线闭合 |
| 法拉第定律 | $\displaystyle\oint_C\vec E\cdot\mathrm d\vec\ell=-\mathrm d\Phi_B/\mathrm dt$ | $\nabla\times\vec E=-\partial\vec B/\partial t$ | 变化的磁场产生涡旋电场 |
| 安培–麦克斯韦定律 | $\displaystyle\oint_C\vec B\cdot\mathrm d\vec\ell=\mu_0I_{\rm enc}+\mu_0\varepsilon_0\mathrm d\Phi_E/\mathrm dt$ | $\nabla\times\vec B=\mu_0\vec J+\mu_0\varepsilon_0\partial\vec E/\partial t$ | 电流和变化电场产生涡旋磁场 |

其中 $\nabla\cdot$ 是**散度**（描述场的源汇），$\nabla\times$ 是**旋度**（描述局域环流）。电磁波问题中的 $\vec E$ 和 $\vec B$ 一般是**总场**。

### 29-4 电磁波从方程组推导（Production and Propagation）

在没有电荷、没有电流的真空中：

$$
\nabla\cdot\vec E=0,\quad\nabla\cdot\vec B=0,
\quad\nabla\times\vec E=-\frac{\partial\vec B}{\partial t},
\quad\nabla\times\vec B=\mu_0\varepsilon_0\frac{\partial\vec E}{\partial t}.
$$

对法拉第定律两侧取旋度，并用向量恒等式
$\nabla\times(\nabla\times\vec E)=\nabla(\nabla\cdot\vec E)-\nabla^2\vec E$，得到

$$
-\nabla^2\vec E
=-\mu_0\varepsilon_0\frac{\partial^2\vec E}{\partial t^2}
\quad\Longrightarrow\quad
\boxed{\nabla^2\vec E=\mu_0\varepsilon_0\frac{\partial^2\vec E}{\partial t^2}}.
$$

同样有 $\nabla^2\vec B=\mu_0\varepsilon_0\partial^2\vec B/\partial t^2$。与标准波动方程比较，得

$$
\boxed{c=\frac1{\sqrt{\mu_0\varepsilon_0}}\approx3.00\times10^8\,\mathrm{m/s}}.
$$

因此光可以解释为**电磁波**。加速运动电荷可辐射电磁波（课件的天线、赫兹实验）。

### 29-5 平面电磁波与方向（Plane Electromagnetic Waves）

沿 $+x$ 传播的一个平面波可写为

$$
\vec E(x,t)=E_0\cos(kx-\omega t)\,\hat y,
\qquad
\vec B(x,t)=B_0\cos(kx-\omega t)\,\hat z.
$$

![平面电磁波中的 E B 与传播方向](./_assets/physics/ch29-ex02.png)

真空平面波具有：

1. $\vec E\perp\vec B$，且二者均垂直于传播方向（**横波**）。
2. 电场和磁场**同相**，相位差为 $0$；相同位置同时达到最大值和零值。
3. 幅值满足 $\boxed{E_0=cB_0}$，传播方向与 $\vec E\times\vec B$ 同向。
4. $c=\lambda f=\omega/k$。

### 29-6 电磁波谱（Electromagnetic Spectrum）

按频率从低到高大致为：无线电波 → 微波 → 太赫兹波 → 红外 → 可见光 → 紫外 → X 射线 → $\gamma$ 射线。频率越高，**单个光子能量** $E=hf$ 越高；波长与频率关系 $\lambda=c/f$。

**课件互动题**：频率数量级 $10^{10}\,\mathrm{Hz}$ 的微波，其波长为 $\lambda=3\times10^8/10^{10}=3\times10^{-2}\,\mathrm m$，即**厘米量级**。

### 29-7 电磁波的能量与坡印廷矢量（Energy and Poynting Vector）

真空电磁能量密度：

$$
\boxed{u=\frac12\varepsilon_0E^2+\frac{B^2}{2\mu_0}}.
$$

对于真空平面波，两项**瞬时相等**，故 $u=\varepsilon_0E^2=B^2/\mu_0$。坡印廷矢量为单位面积单位时间通过的能量：

$$
\boxed{\vec S=\frac1{\mu_0}\vec E\times\vec B},
\qquad\boxed{I=\langle S\rangle=\frac12\varepsilon_0cE_0^2
=\frac{cB_0^2}{2\mu_0}}.
$$

**课件 Example 3：太阳辐射强度**。假设在地球附近单色正弦波平均强度 $I=1350\,\mathrm{W/m^2}$，则

$$
E_0=\sqrt{\frac{2I}{\varepsilon_0c}}
\approx\boxed{1.01\times10^3\,\mathrm{V/m}},
\qquad B_0=\frac{E_0}{c}\approx\boxed{3.36\times10^{-6}\,\mathrm T}.
$$

这里 $I$ 是**时间平均强度**，不能漏掉正弦平均 $\langle\cos^2\rangle=1/2$。

### 29-8 辐射压（Radiation Pressure，选学）

对于正入射的理想情形，完全吸收的表面平均辐射压 $p=I/c$；完全镜面反射时 $p=2I/c$。此处假设反射理想且入射与表面法线一致。

### 第 29 章易错点

- 磁场的环量不只由**传导电流**决定，时变电通量也贡献位移电流项。
- 两个同一边界的曲面，必须得到相同的安培–麦克斯韦环路积分结果。
- 电磁波中的 $E$、$B$ 是场强幅度时和瞬时值时的区别；计算平均能流别漏 $1/2$。
- **自测**：为什么两板间真空没有自由电荷流过，却需要位移电流？电磁波的传播方向如何由 $\vec E\times\vec B$ 判定？

---

## 第 32 章：狭义相对论（Special Theory of Relativity）

> **课件主线**：伽利略相对性 → 迈克耳孙–莫雷实验 → 爱因斯坦两公设 → 同时性的相对性 → 时间膨胀、长度收缩 → 洛伦兹变换、速度变换 → 相对论动量、能量与质能关系。

### 32-1 经典相对性与狭义相对论两公设

- **经典相对性原理**：在全部惯性系中，力学规律形式相同；伽利略变换 $x'=x-vt,\ t'=t$ 假设时间绝对。
- **迈克耳孙–莫雷实验**：寻找“以太风”的预期干涉条纹变化未得到相应结果，推动了空间、时间观念的更新。
- **狭义相对论第一公设**：所有惯性参考系中的物理定律具有相同形式。
- **第二公设**：真空中的光速 $c$ 与光源、观察者的惯性运动状态无关。

定义

$$
\boxed{\beta=\frac vc},\qquad
\boxed{\gamma=\frac1{\sqrt{1-v^2/c^2}}}.
$$

当 $v\ll c$ 时，$\gamma\approx1$，相对论效应极小。

### 32-2 同时性的相对性（Relativity of Simultaneity）

“两个不同地点的事件是否同时”依赖观察者的惯性系。注意：只有当事件在同一时空点发生，所有观察者才同意它们重合；**空间上分离的两事件**，不同参考系可以给出不同的时间差。

洛伦兹变换中的 $t'=\gamma(t-vx/c^2)$ 将时间和位置联系起来，这也说明不能把“看见的先后顺序”简单等同于“事件发生的先后顺序”：要考虑光传播延迟。

### 32-3 时间膨胀（Time Dilation）

**固有时间** $\Delta\tau$ 是**同一只静止钟**记录的两个事件的时间间隔（两事件在这只钟的静止系中发生于同一地点）。相对于该钟运动的实验室系测得

$$
\boxed{\Delta t=\gamma\Delta\tau}.
$$

![光钟与时间膨胀示意](./_assets/physics/ch32-ex01.png)

**光钟推导**：光钟的两镜在自身静止系中相距 $L$，光一往返的固有时间 $\Delta\tau=2L/c$。在外部观察者看来，光走斜向折线路程，半周期满足

$$
\left(\frac{c\Delta t}{2}\right)^2
=L^2+\left(\frac{v\Delta t}{2}\right)^2,
$$

因此 $\Delta t=2L/\sqrt{c^2-v^2}=\gamma\Delta\tau$。这里比较的是**两次钟响**之间的时间，不是简单比较照片里钟的外观。

**课件 Example 1：运动 $\mu$ 子寿命**。静止寿命 $\Delta\tau=2.2\times10^{-6}\,\mathrm s$，实验室速度 $v=0.6c$。

$$
\gamma=\frac1{\sqrt{1-0.6^2}}=1.25,
\quad \boxed{\Delta t=2.75\,\mu\mathrm s}.
$$

在实验室中平均飞行距离约为

$$
\boxed{d=v\Delta t=0.6(3.0\times10^8)(2.75\times10^{-6})
\approx495\,\mathrm m}.
$$

**课件 Example 2：空间站上的钟**。空间站相对地面惯性近似参考系的速度取 $v\approx7700\,\mathrm{m/s}$，在站内经过 100 天。只计**狭义相对论运动效应**，$\gamma\approx1+v^2/(2c^2)$，站内固有时间与外部时间差的量级为

$$
\Delta t-\Delta\tau\approx\frac{v^2}{2c^2}\Delta\tau
=\frac{7700^2}{2(2.9979\times10^8)^2}(100\times86400)
\approx\boxed{2.85\times10^{-3}\,\mathrm s}.
$$

因此空间站宇航员仅因运动效应比地面参考钟少经历约 **2.85 毫秒**。真实近地轨道还存在引力场以及非惯性运动等影响；这里不能当作完整 GPS 或实际宇航员生理年龄差的高精度计算。

### 32-4 长度收缩（Length Contraction）

**固有长度** $L_0$ 是在物体静止系中测出的长度；在物体相对运动的参考系里，测量者必须**同一时刻测定两端位置**：

$$
\boxed{L=\frac{L_0}{\gamma}=L_0\sqrt{1-v^2/c^2}}.
$$

长度收缩只发生在**沿相对运动方向的尺寸**，垂直方向不变。

**课件 Example 3：运动飞船上的画**。画的固有尺寸为 $1.0\,\mathrm m\times1.5\,\mathrm m$，假设 $1.5\,\mathrm m$ 边沿速度 $v=0.9c$ 的方向。由于 $1/\gamma=\sqrt{1-0.9^2}\approx0.436$，地面在同一时刻测得

$$
L=1.5\times0.436\approx0.654\,\mathrm m,
$$

因此尺寸约为 $1.0\,\mathrm m\times0.65\,\mathrm m$。该结论是**同时测量意义下的几何尺寸**，不等同于相机拍照的视觉形状（视觉还受光传播时间影响）。

### 32-5 洛伦兹变换与速度变换（Lorentz Transformation）

设 $S'$ 沿 $S$ 的 $+x$ 方向以速度 $v$ 运动，且 $t=t'=0$ 时原点重合：

$$
\boxed{x'=\gamma(x-vt),\quad
 t'=\gamma\left(t-\frac{vx}{c^2}\right),\quad y'=y,\ z'=z}.
$$

反变换：$x=\gamma(x'+vt')$，$t=\gamma(t'+vx'/c^2)$。

沿 $x$ 方向的速度变换：

$$
\boxed{u'_x=\frac{u_x-v}{1-u_xv/c^2}},
\qquad
\boxed{u_x=\frac{u'_x+v}{1+u'_xv/c^2}}.
$$

**课件 Example 4：两飞船从地球看以 $0.9c$ 反向运动**。在其中一飞船上，另一飞船的速率

$$
\boxed{u_{\rm rel}=\frac{0.9c+0.9c}{1+0.9^2}
\approx0.9945c<c}.
$$

不能用经典速度相加得到 $1.8c$。**课件 Example 5**：令 $u_x=c$ 代入变换，仍得到 $u'_x=c$。

### 32-6 相对论动量、能量与质能关系（Relativistic Dynamics）

推荐统一使用**不变静质量** $m$，避免将“相对论质量随速度增加”当作现代标准表述：

$$
\boxed{\vec p=\gamma m\vec v},\qquad
\boxed{E=\gamma mc^2},\qquad
\boxed{K=(\gamma-1)mc^2},\qquad
\boxed{E_0=mc^2}.
$$

能量—动量关系：

$$
\boxed{E^2=p^2c^2+m^2c^4}.
$$

对光子，$m=0$，因而 $E=pc$。当速度远小于光速，$\gamma\approx1+v^2/(2c^2)$，于是 $K\approx mv^2/2$，恢复经典结果。

**课件用语说明**：一些幻灯片采用“relativistic mass”记号 $m=\gamma m_0$。为避免与静质量混淆，本笔记使用 $m$ 表示不变静质量，$\gamma m$ 作为动量系数。两种写法的数值公式可对照，但物理概念表达不同。

### 第 32 章易错点

- **固有时间**涉及同一位置发生的两事件；**固有长度**在物体静止系测量。
- 时间膨胀不是“同一参考系中所有时间都变慢”；比较时要明确各自参考系和所选事件。
- 长度收缩需要测量两端的**同时性**，不能漏。
- **自测**：两个相向 $0.9c$ 的飞船为何不能相对 $1.8c$？为什么时间变换式中必须有 $vx/c^2$ 项？

---

## 第 33 章：早期量子理论与原子模型（Early Quantum Theory and Models of Atom）

> **课件主线**：黑体辐射和普朗克假设 → 光子与光电效应 → 康普顿效应 → 波粒二象性、德布罗意波 → 早期原子模型、氢原子光谱和玻尔理论。课件中还包括电子显微镜、粒子对产生等选学内容。

### 33-1 黑体辐射与普朗克量子假设（Planck's Quantum Hypothesis）

**黑体**是能够吸收射入其表面全部电磁辐射的理想模型，处于热平衡时具有由温度决定的辐射谱。实验现象包括：

- 温度升高，辐射总功率随 $T^4$ 增加（斯特藩–玻尔兹曼定律）；
- 谱的峰值随温度升高向较短波长移动（维恩位移定律）。

经典瑞利–金斯公式在高频区预言无限增长（**紫外灾难**）。普朗克提出振子能量只能取离散值：

$$
\boxed{E_n=nhf},\qquad n=0,1,2,\ldots,
$$

其中 $h=6.62607015\times10^{-34}\,\mathrm{J\,s}$，$f$ 为频率，单个能量量子 $hf$。课件用此展示“能量量子化”的思想；现代量子谐振子的完整能级还包含零点能 $\tfrac12hf$，这是后续理论的扩展。

### 33-2 光子与光电效应（Photon Theory & Photoelectric Effect）

爱因斯坦将光的能量交换看作光子吸收与发射：

$$
\boxed{E_\gamma=hf=\frac{hc}{\lambda}},\qquad
\boxed{p_\gamma=\frac{E_\gamma}{c}=\frac h\lambda}.
$$

**光电效应**：光照射金属产生光电子，若 $W_0$ 为金属逸出功，则光子能量守恒给出

$$
\boxed{K_{\max}=hf-W_0=eV_s},\qquad
\boxed{f_0=\frac{W_0}h}.
$$

$V_s$ 为**遏止电压的大小**，在实际 I–V 曲线的电压坐标中遏止点可能位于负电压侧。

![光电效应能量示意](./_assets/physics/ch33-ex01.png)

**课件观察事实与解释**：

| 观察事实 | 光子解释 |
| --- | --- |
| 存在截止频率 $f_0$ | $hf<W_0$，单个光子不足以逸出电子 |
| 固定频率增大入射强度，饱和光电流通常增大 | 单位时间入射光子数增加，释放电子的数量增加 |
| 固定强度增加频率，最大动能增大 | $K_{\max}$ 随 $f$ 线性增大（若仍在光电效应条件下） |
| 响应几乎不需等待能量积累 | 单个电子与光子交换离散能量 |

**课件 Example 2：50 W 灯泡的光子数**。为估算上限，**额外假设**电功率全部转化为波长 $550\,\mathrm{nm}$ 的可见单色光：

$$
N_{\rm per\ sec}=\frac P{hc/\lambda}
=\frac{(50)(550\times10^{-9})}{(6.626\times10^{-34})(3.00\times10^8)}
\approx\boxed{1.38\times10^{20}\,\mathrm{s^{-1}}}.
$$

真实灯泡并非 100% 转化为此波长的可见光，故该结果仅为所设模型下的估算。

### 33-3 康普顿散射（Compton Effect）

高能光子与近似自由、初始静止的电子碰撞后发生散射，光子动量及能量改变。利用相对论能量、动量守恒，得到

$$
\boxed{\Delta\lambda=\lambda'-\lambda
=\frac h{m_ec}(1-\cos\phi)}.
$$

$\phi$ 为**光子散射角**；电子的康普顿波长 $\lambda_C=h/(m_ec)\approx2.426\,\mathrm{pm}$。由于 $1-\cos\phi\ge0$，散射波长不会比入射波长更短（该简单自由电子模型）。

**课件 Example 4：$\lambda_0=0.2\,\mathrm{nm}$ 的 X 射线**。

- $\phi=45^\circ$：$\Delta\lambda=2.426(1-\cos45^\circ)\,\mathrm{pm}\approx0.711\,\mathrm{pm}$，所以 $\lambda'\approx\boxed{0.200711\,\mathrm{nm}}$。
- $\phi=90^\circ$：$\Delta\lambda=2.426\,\mathrm{pm}$，所以 $\lambda'\approx\boxed{0.202426\,\mathrm{nm}}$。
- 最大波长偏移在 $\phi=180^\circ$：$\Delta\lambda_{\max}=2\lambda_C\approx4.852\,\mathrm{pm}$。

**与光电效应区分**：光电效应通常着眼于**光子被吸收、电子逸出**；康普顿效应着眼于**散射后光子仍存在但能量减小**。

### 33-4 波粒二象性与德布罗意波（Wave–Particle Duality）

德布罗意提出所有物质粒子也可对应波长：

$$
\boxed{\lambda=\frac hp}.
$$

非相对论时 $p=mv$；粒子经过电压 $V$ 从静止加速（忽略相对论效应），若电荷量绝对值为 $|q|$：

$$
|q|V=\frac{p^2}{2m}
\quad\Longrightarrow\quad
\boxed{\lambda=\frac h{\sqrt{2m|q|V}}}.
$$

**课件 Example 5**：

(a) $70\,\mathrm{kg}$ 的人以 $5\,\mathrm{m/s}$ 运动，$\lambda\approx6.626\times10^{-34}/350\approx\boxed{1.89\times10^{-36}\,\mathrm m}$，微小到无法观察常规衍射。

(b) 电子经 $100\,\mathrm V$ 加速（非相对论近似），

$$
\lambda\approx\boxed{1.23\times10^{-10}\,\mathrm m=0.123\,\mathrm{nm}}.
$$

**课件互动题**：在非相对论条件下，电子和质子德布罗意波长相同，则 $p=h/\lambda$ 相同；质量不同导致速度、动能一般不同。

电子衍射实验（戴维孙–革末实验、G. P. 汤姆孙实验）支持物质波。量子力学中的波函数描述**概率幅**，不能把电子简单想象为经典水波或绕核的小弹珠。

### 33-5 氢原子线光谱与玻尔模型（Hydrogen Spectrum and Bohr Model）

卢瑟福核式模型解释了原子散射实验，却无法用经典行星轨道解释原子稳定性与离散光谱。玻尔模型引入特定稳定能级及轨道角动量量子化：

$$
\boxed{m_evr=n\hbar},\qquad \hbar=\frac h{2\pi}.
$$

对氢原子，电子向心力来自库仑吸引：

$$
\frac{m_ev^2}{r}=\frac{e^2}{4\pi\varepsilon_0r^2},\qquad m_evr=n\hbar.
$$

联立两式：

$$
\boxed{r_n=a_0n^2},\quad a_0\approx0.0529\,\mathrm{nm};
\qquad\boxed{E_n=-\frac{13.6\,\mathrm{eV}}{n^2}}.
$$

对于单电子类氢离子（核电荷数 $Z$，忽略约化质量等修正），

$$
\boxed{E_n\approx-\frac{13.6Z^2}{n^2}\,\mathrm{eV}}.
$$

电子由 $n_i$ 向较低能级 $n_f$ 跃迁，发出光子：

$$
\boxed{hf=E_{n_i}-E_{n_f}
=13.6Z^2\left(\frac1{n_f^2}-\frac1{n_i^2}\right)\mathrm{eV}}.
$$

用波长写成里德伯公式 $1/\lambda=RZ^2(1/n_f^2-1/n_i^2)$。氢原子 Lyman（终态 $n_f=1$，紫外）、Balmer（$n_f=2$，可见部分）、Paschen（$n_f=3$，红外）系列依终止能级区分。

![氢原子能级与跃迁](./_assets/physics/ch33-ex02.png)

**课件 Example 6：氢原子第 3 激发态**，即 $n=4$。若统计从初始 $n=4$ 经可能级联跃迁到低能级可出现的**不同谱线种类**，共有

$$
\boxed{\binom42=\frac{4\cdot3}{2}=6\text{ 种}}.
$$

**最长波长**意味着能量差最小，在 $4\to3$ 跃迁：

$$
\Delta E=13.6\left(\frac1{3^2}-\frac1{4^2}\right)
\approx0.661\,\mathrm{eV},\qquad
\boxed{\lambda_{\max}\approx1.88\,\mu\mathrm m}.
$$

这不是说**单个原子的一次退激过程同时发出 6 种光子**；而是所有可能跃迁形成的光谱线集合。

**课件 Example 7：$\mathrm{He}^{+}$ 的电离与跃迁**。

- 基态电离能：$13.6Z^2=13.6\times4=\boxed{54.4\,\mathrm{eV}}$。
- $n=6\to2$ 辐射：$13.6\times4(1/2^2-1/6^2)=\boxed{12.09\,\mathrm{eV}}$。
- 这个光子能量等于氢原子的 $1\to3$ 吸收能量 $13.6(1-1/9)\approx12.09\,\mathrm{eV}$，因此**基态氢原子**在理想能级模型与匹配条件下可吸收该光子。

### 33-6 本章的理论边界及选学内容

- 玻尔模型在氢样单电子体系中取得成功，但固定经典轨道的图像**不是**现代量子力学的电子分布图像；第 35 章用波函数与量子数替代。
- 电子显微镜利用电子的波动性与短德布罗意波长；实际分辨率还受透镜像差、稳定性等因素影响。
- 单个高能光子在满足动量守恒条件的环境（如邻近原子核）可发生电子—正电子**成对产生**；阈值能量至少 $2m_ec^2=1.022\,\mathrm{MeV}$，还要满足整个体系动量守恒。
- **自测**：增加光强与增加频率对光电效应分别影响什么？康普顿散射角变大时波长如何变化？为什么氢原子第 3 激发态是 $n=4$？

---

## 第 35 章：原子的量子力学（Quantum Mechanics of Atoms）

> **课件主线**：氢原子薛定谔方程 → 四个量子数 → 氢原子波函数及电子云 → 多电子原子与泡利不相容原理 → 周期表；激光及能带作为拓展。

### 35-1 氢原子的薛定谔方程（Schrödinger Equation for Hydrogen）

电子受到原子核的库仑吸引，用相对坐标和约化质量 $\mu_r$ 描述，定态方程为

$$
\boxed{\left[-\frac{\hbar^2}{2\mu_r}\nabla^2
-\frac{e^2}{4\pi\varepsilon_0r}\right]\psi(\vec r)
=E\psi(\vec r)}.
$$

其波函数可在球坐标中分离为径向部分和角向部分：

$$
\boxed{\psi_{n\ell m_\ell}(r,\theta,\phi)
=R_{n\ell}(r)Y_\ell^{m_\ell}(\theta,\phi)}.
$$

$|\psi|^2$ 是**单位体积概率密度**，在空间积分等于 1。轨道指的是波函数对应的量子态，**不是电子在空间走过的确定路径**。

### 35-2 四个量子数（Quantum Numbers）

| 量子数 | 符号 | 允许取值 | 物理意义 |
| --- | --- | --- | --- |
| 主量子数 | $n$ | $1,2,3,\ldots$ | 氢原子能级；主要控制轨道尺度 |
| 轨道角动量量子数 | $\ell$ | $0,1,\ldots,n-1$ | 决定轨道角动量大小 |
| 磁量子数 | $m_\ell$ | $-\ell,-\ell+1,\ldots,\ell$ | 轨道角动量沿选定轴的分量 |
| 自旋磁量子数 | $m_s$ | $+1/2,-1/2$（电子） | 电子自旋投影 |

轨道角动量量子化：

$$
\boxed{L=\sqrt{\ell(\ell+1)}\hbar},\qquad
\boxed{L_z=m_\ell\hbar}.
$$

电子自旋 $s=1/2$，其大小为 $S=\sqrt{s(s+1)}\hbar=\sqrt3\hbar/2$，而 $S_z=m_s\hbar$。轨道磁量子数的允许范围说明**空间量子化**。课件以塞曼效应和斯特恩–盖拉赫实验引出磁矩与自旋。

**课件 Example 1：$n=2$ 的电子有多少种状态？**

- $\ell=0$：$m_\ell=0$，配合两种 $m_s$，有 2 态。
- $\ell=1$：$m_\ell=-1,0,1$，各配合两种 $m_s$，有 6 态。
- 总共 $\boxed{2+6=8}$ 个单电子状态。

一般固定主量子数 $n$ 的状态数（含自旋）为

$$
\boxed{g_n=2\sum_{\ell=0}^{n-1}(2\ell+1)=2n^2}.
$$

**课件 Example 2：这些状态的能量和角动量**。在非相对论氢原子、未加外场并忽略精细结构时，$n=2$ 全部态能量 $E_2=-13.6/4=\boxed{-3.4\,\mathrm{eV}}$。当 $\ell=0$：$L=0$；当 $\ell=1$：$L=\sqrt2\hbar$。**相同 $n$ 的能量相同，不等于轨道角动量相同**。

### 35-3 氢原子波函数与概率分布（Hydrogen Wave Functions）

氢原子基态 $1s$ 的空间波函数为

$$
\boxed{\psi_{100}(r)=\frac1{\sqrt{\pi a_0^3}}e^{-r/a_0}}.
$$

概率密度为 $|\psi_{100}(r)|^2=e^{-2r/a_0}/(\pi a_0^3)$。但**径向概率密度**还需球壳体积因子 $4\pi r^2$：

$$
\boxed{P_r(r)=4\pi r^2|\psi_{100}(r)|^2
=\frac{4r^2}{a_0^3}e^{-2r/a_0}}.
$$

![氢原子1s径向概率分布](./_assets/physics/ch35-ex01.png)

令 $\mathrm dP_r/\mathrm dr=0$，非零最大值位置为 $\boxed{r=a_0}$。**注意**：$|\psi|^2$ 在 $r=0$ 最大，而径向概率 $P_r$ 在 $r=a_0$ 最大，两者不矛盾——后者考虑了半径为 $r$ 的球壳体积。

### 35-4 多电子原子与泡利不相容原理（Pauli Exclusion Principle）

对于多电子原子，电子间排斥使能量一般不仅依赖 $n$，还依赖 $\ell$ 等因素。基态电子排布遵循：

1. **能量最低原理**：在可允许状态中优先占据总能量较低的状态（实际排序依原子而异）。
2. **泡利不相容原理**：同一原子中两个电子**不能具有完全相同的四个量子数** $(n,\ell,m_\ell,m_s)$。
3. **洪特规则**（补充）：同能量的简并轨道在可能条件下先尽量单占并保持自旋平行，再成对。

各亚层容量：

| 亚层 | $\ell$ | 轨道数 $2\ell+1$ | 电子容量 $2(2\ell+1)$ |
| --- | ---: | ---: | ---: |
| $s$ | 0 | 1 | 2 |
| $p$ | 1 | 3 | 6 |
| $d$ | 2 | 5 | 10 |
| $f$ | 3 | 7 | 14 |

每个主层的最大容量为 $2n^2$；例如 $n=3$ 最多 $18$ 个电子。它们**不必全部占据同一能量**，多电子原子中能级还受到电子间相互作用和屏蔽的影响。

**课件 Example 3：判断电子排布是否允许**。

- (a) $1s^22s^32p^3$：**不允许**，$2s$ 最多容纳 2 个电子。
- (b) $1s^22s^22p^53s^2$：从每个亚层最大容量看**允许**，但不是通常基态的最低能排布（激发态配置）。
- (c) $1s^22s^22p^62d^2$：**不允许**，$n=2$ 只允许 $\ell=0,1$，不存在 $2d$ 亚层。

**额外互动题**：$3p^7$ 不允许（$p$ 最多 6 个）；$2d^1$ 不允许（没有 $2d$）；但 $3d^74s^2$ 或 $3d^{10}4s^24p^6$ 本身不因亚层容量而被禁用。

### 35-5 周期表与能级（The Periodic Table）

元素化学性质与外层价电子排布密切相关。课件示例：

$$
\mathrm O:1s^22s^22p^4;\qquad
\mathrm{Na}:1s^22s^22p^63s^1;\qquad
\mathrm{Mg}:1s^22s^22p^63s^2.
$$

电子排布中的 $4s$、$3d$ 能级先后会随原子和电离状态变化，不应把简化的“轨道填充顺序”当成所有情况的严格不变规律。

### 35-6 激光与固体能带（选学；Lasers and Solids）

**激光（LASER）**意为受激辐射光放大。关键包括：

- **受激辐射**：入射光子促使处在激发态的原子发射同频率、相位相干的光子。
- **粒子数反转**：高能级粒子数相对于低能级的分布满足获得净放大的条件。
- **亚稳态、泵浦与谐振腔**：有利于建立反转并放大特定模式。激光常表现为高方向性、良好单色性与相干性。

**第 36 章预览**：课件末尾还出现晶体、能带、半导体和 p–n 结的概览，但未提供完整的第 36 章授课课件，此处只作承接，不视作已系统整理第 36 章。

### 第 35 章易错点

- $n=2$ 的电子有 **8 个可能量子态**，而不是“氢原子 $n=2$ 能放 8 个电子”这类对**单电子原子**的误述；$2n^2$ 常用于主壳层可能状态/容量计数。
- $L=\sqrt{\ell(\ell+1)}\hbar$，不是 $\ell\hbar$；$L_z=m_\ell\hbar$。
- $|\psi|^2$ 和径向概率 $P_r(r)$ 不同，计算球壳概率必须乘以 $4\pi r^2$。
- $n,\ell,m_\ell,m_s$ 各有允许范围；只对容量做算术检查还不够。
- **自测**：为什么不存在 $2d$ 亚层？为何氢原子基态最大径向概率在 $a_0$，而空间密度最大在原点？

---

## 磁学、电磁感应与近代物理综合复习

### 公式速查

| 主题 | 公式 | 首先确认的条件 |
| --- | --- | --- |
| 载流导线磁力 | $\vec F=I\int\mathrm d\vec\ell\times\vec B$ | 磁场是否均匀、导线方向 |
| 洛伦兹磁力 | $\vec F_B=q\vec v\times\vec B$ | 电荷正负、速度与场夹角 |
| 电流环磁矩 | $\vec\mu=NIA\hat n$ | 面法线由右手定则确定 |
| 毕奥–萨伐尔 | $\mathrm d\vec B=\frac{\mu_0I}{4\pi}\frac{\mathrm d\vec\ell\times\hat r}{r^2}$ | 电流元到场点的矢量 |
| 稳恒安培环路 | $\oint\vec B\cdot\mathrm d\vec\ell=\mu_0I_{\rm enc}$ | 电流稳恒、有无足够对称性 |
| 法拉第定律 | $\mathcal E=-N\,\mathrm d\Phi_B/\mathrm dt$ | 磁通方向与回路正方向 |
| 旋转导体棒 | $|\mathcal E|=\frac12B\omega L^2$ | 均匀垂直磁场、从轴到端点 |
| 自感与储能 | $\mathcal E_L=-L\,\mathrm dI/\mathrm dt$；$U=LI^2/2$ | 常量线性电感 |
| 位移电流 | $I_d=\varepsilon_0\,\mathrm d\Phi_E/\mathrm dt$ | 真空模型、曲面法向 |
| 电磁波幅值 | $E_0=cB_0$ | 真空平面电磁波 |
| 相对论时间 | $\Delta t=\gamma\Delta\tau$ | 同一钟记录的固有时间 |
| 相对论长度 | $L=L_0/\gamma$ | 运动方向，同一时刻量端点 |
| 光子能量 | $E=hf=hc/\lambda$ | 光子频率 / 真空波长 |
| 德布罗意波长 | $\lambda=h/p$ | 是否需要相对论动量 |
| 氢原子能级 | $E_n=-13.6Z^2/n^2\,\mathrm{eV}$ | 单电子类氢体系近似 |
| 角动量量子化 | $L=\sqrt{\ell(\ell+1)}\hbar$ | $0\le\ell\le n-1$ |

### 跨章联系与统一解题框架

1. **从受力到磁场来源**：第 25 章用 $\vec B$ 求力，第 26 章说明 $\vec B$ 如何由电流产生；先分清“求场”还是“求力”。
2. **电磁感应与电感**：第 27 章的磁通变化引起电动势，第 28 章把这种反馈应用于本电路和相邻电路。
3. **麦克斯韦统一**：第 27 章 $\partial\vec B/\partial t\to\vec E$，第 29 章 $\partial\vec E/\partial t\to\vec B$；在无源空间相互耦合形成传播的电磁波。
4. **从经典到现代**：第 32 章修正高速运动的时空与能量观念，第 33 章引入量子概念，第 35 章用量子态解释原子结构。
5. **向量与标量**：磁场/磁力是向量，磁通/电动势是带有方向约定的标量，电感是以几何和材料决定的回路参数，计算步骤不能混用。

### 练习题（先独立尝试）

1. 两根平行长导线相距 $d$，电流分别为 $I$ 和 $-2I$，各受到的力方向如何？单位长度的力大小是什么？
2. 在半径 $R$ 的圆环轴线上，比较 $B(0)$ 与 $B(R)$ 的大小，并解释为何横向分量抵消。
3. 当滑棒电源恒定而杆速增加时，电路电流怎样变化？何时电流为零？
4. 正弦电磁波的时间平均能流为什么比最大瞬时能流小一半？
5. 速度为 $0.8c$ 的理想光钟，$\gamma$ 是多少？同一静止钟的 1 秒对应外部观察者多久？
6. 氢原子 $n=3\to2$ 的光子能量如何算？$n=3$ 的壳层有几个不同的单电子量子态（含自旋）？

### 本次更新课件对应表（2026-10-22）

| 课件文件 | 本笔记章节 | 已覆盖的主要知识点 |
| --- | --- | --- |
| `Ch25 Magnetism.pptx` | 第 25 章 | 电流磁力、磁矩、洛伦兹力、霍尔效应 |
| `Ch26 Sources of Magnetic Field.pptx` | 第 26 章 | 毕奥–萨伐尔、安培环路、各类电流磁场、磁材料 |
| `Ch27 Electromagnetic induction.pptx` | 第 27 章 | 法拉第、楞次定律、动生与感生电动势 |
| `Ch28 Inductance.pptx` | 第 28 章 | 自感、互感、储能、LR/LC 选学 |
| `Ch29 Maxwell Eqs & EM Waves.pptx` | 第 29 章 | 位移电流、麦克斯韦方程、波与能量 |
| `Ch32  Special Theory of Relativity.pptx` | 第 32 章 | 同时性、时钟、长度、洛伦兹变换、动量和能量 |
| `Ch33 Early Theory of Quantum.pptx` | 第 33 章 | 光电效应、康普顿、德布罗意波、玻尔模型 |
| `Ch35  Quantum Mechanics of Atoms.pptx` | 第 35 章 | 量子数、氢原子波函数、电子排布与泡利原理 |

> **整理边界**：原文件含第 19–22 章，新增内容基于此次上传的第 25–29、32、33、35 章课件。**第 23–24、30–31、34 章未提供课件，未伪造为已整理章节**。例题中明确设定的几何、初值、近似条件及补充推导，是为讲解课件方法而整理或补全的内容，不意味着原 PPT 逐字包含这些数据。原始课件中的独立选择题并未全部转录。
