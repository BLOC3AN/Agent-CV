import React from 'react';
import { CV, CVLayout } from '../types';
import { CVBlockRenderer } from './CVBlockRenderer';
import { printCSSForDesign } from '../lib/print-css';
import { cvTypographyStyle } from '../lib/cv-typography';

/**
 * Bản dựng một cột dành riêng cho máy in.
 *
 * Quy tắc `@media print` trong `index.css` ẩn `body *` rồi chỉ cho phần tử này
 * hiện lại — nên KHÔNG có nó trên trang thì lệnh in cho ra giấy trắng. Vì vậy
 * mọi màn hình có nút in đều phải dựng đúng MỘT bề mặt: trình sửa dựng của
 * mình, popup xem trước dựng của nó, và hai cái không bao giờ cùng lúc (id
 * trùng sẽ làm quy tắc in bắt nhầm phần tử).
 */
export function CVPrintSurface({ cv, layout }: { cv: CV; layout: CVLayout }) {
  return (
    <div
      id="cv-print-surface"
      data-testid="cv-print-surface"
      className="hidden cv-root"
      data-variant="print"
      style={{ '--cv-accent': cv.design.accentColor, ...cvTypographyStyle(cv.design) } as React.CSSProperties}
    >
      <style dangerouslySetInnerHTML={{ __html: printCSSForDesign(cv.design) }} />
      <article className="cv-page">
        <CVBlockRenderer cv={cv} layout={layout} variant="print" />
      </article>
    </div>
  );
}
