import type { CvDocument } from '@cv/shared';

/** The content of `docs/design/cv-template/resume-b-uk.html` as a document. */
export const ukSample: CvDocument = {
  locale: 'uk',
  contacts: {
    fullName: 'Олег Савчук',
    email: 'oleh.savchuk@example.com',
    phone: '',
    location: 'Львів',
    links: [],
  },
  headline: 'Frontend-розробник',
  summary: {
    text: 'Frontend-розробник з досвідом створення інтерфейсів на React і TypeScript для продуктових команд.',
    factIds: [],
  },
  experience: [
    {
      id: 'p1',
      company: 'ТОВ «Приклад Софт»',
      title: 'Frontend-розробник',
      location: 'Львів',
      start: '2022-09',
      end: null,
      current: true,
      groups: [
        {
          id: 'g1',
          title: null,
          items: [
            {
              id: 'b1',
              text: 'Розробив бібліотеку UI-компонентів, яку використовують три внутрішні продукти.',
              factIds: [],
            },
            {
              id: 'b2',
              text: 'Переписав форму оформлення замовлення з урахуванням доступності (WCAG 2.1 AA).',
              factIds: [],
            },
          ],
        },
      ],
    },
  ],
  education: [
    {
      id: 'e1',
      institution: 'Львівський державний університет (приклад)',
      degree: "Бакалавр комп'ютерних наук",
      start: '2018',
      end: '2022',
    },
  ],
  skills: [
    {
      id: 'g0',
      title: null,
      items: ['React', 'TypeScript', 'CSS', 'Vite', 'Jest'].map((name, index) => ({
        id: `s${index}`,
        name,
      })),
    },
  ],
  additional: [],
};
