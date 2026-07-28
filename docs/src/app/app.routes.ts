import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/home').then(m => m.HomeComponent),
      },
      {
        path: 'installation',
        loadComponent: () => import('./pages/installation').then(m => m.InstallationComponent),
      },
      {
        path: 'quick-start',
        loadComponent: () => import('./pages/quick-start').then(m => m.QuickStartComponent),
      },
      {
        path: 'adapter',
        loadComponent: () => import('./pages/adapter').then(m => m.AdapterComponent),
      },
      {
        path: 'express-compat',
        loadComponent: () => import('./pages/express-compat').then(m => m.ExpressCompatComponent),
      },
      {
        path: 'fastify-compat',
        loadComponent: () => import('./pages/fastify-compat').then(m => m.FastifyCompatComponent),
      },
      {
        path: 'benchmarks',
        loadComponent: () => import('./pages/benchmarks').then(m => m.BenchmarksComponent),
      },
      {
        path: 'migration',
        loadComponent: () => import('./pages/migration').then(m => m.MigrationComponent),
      },
      {
        path: 'examples',
        loadComponent: () => import('./pages/examples').then(m => m.ExamplesComponent),
      },
      {
        path: 'api/factory',
        loadComponent: () => import('./pages/api-factory').then(m => m.ApiFactoryComponent),
      },
      {
        path: 'api/config',
        loadComponent: () => import('./pages/configuration').then(m => m.ConfigurationComponent),
      },
      // Legacy alias — the BunAdapter reference lives at /adapter.
      {
        path: 'api/adapter',
        redirectTo: 'adapter',
        pathMatch: 'full',
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
