import { Injectable } from '@angular/core';

import { CrudService } from '../../core/http/crud.service';
import { API } from '../../core/constants/api-endpoints';

/** Customers — full CRUD over the client resource (api/routes/client.routes.js). */
export interface Customer {
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class CustomersService extends CrudService<Customer> {
  protected override resourcePath(): string {
    return API.customers;
  }
}
