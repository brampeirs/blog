---
title: "The Quirks of Injector Hierarchy When Using NgModules"
pubDate: "Jan 13 2026"
description: "How lazy loading can silently break your Angular app by creating multiple service instances"
heroImage: "../../assets/blog-weight-loss.png"
---

While refactoring a large Angular project that was still heavily relying on NgModules, I moved some routes from eager to lazy loading. The build succeeded without errors, but at runtime, things started behaving strangely. The recently visited products feature stopped working correctly—it was as if the app had amnesia, forgetting what users had just viewed.

No console errors. No TypeScript warnings. Just broken functionality.

It took me hours to realize what was happening: **my service was being instantiated twice**, creating two separate instances with their own isolated state. This is the story of how Angular's injector hierarchy can silently break your app when you refactor from eager to lazy loading.

## The Coffee Shop App: A Real-World Example

To demonstrate this issue, I built a simple coffee shop application. Users can browse coffees on the home page and click to view details. The app tracks recently visited products using a `RecentlyVisitedService` that maintains a list of the last 3 coffees viewed.

Here's the service implementation:

```ts
@Injectable()
export class RecentlyVisitedService {
  private readonly maxItems = 3;
  private visitedCoffees = new BehaviorSubject<Coffee[]>([]);

  visitedCoffees$: Observable<Coffee[]> = this.visitedCoffees.asObservable();

  addVisitedCoffee(coffee: Coffee): void {
    const current = this.visitedCoffees.value;
    const filtered = current.filter((c) => c.id !== coffee.id);
    const updated = [coffee, ...filtered].slice(0, this.maxItems);
    this.visitedCoffees.next(updated);
  }
}
```

Simple enough, right? The service uses a `BehaviorSubject` to maintain state. When you visit a product detail page, it adds that coffee to the list. The home page displays this list so users can quickly revisit products they've viewed.

## Scenario 1: Eager Loading (Everything Works)

Initially, both the home page and product detail page were eagerly loaded:

```ts
const routes: Routes = [
  { path: "", component: HomeComponent },
  { path: "product/:id", component: ProductDetailComponent },
];

@NgModule({
  declarations: [HomeComponent],
  imports: [
    RouterModule.forRoot(routes),
    RecentlyVisitedModule,
    ProductDetailModule,
  ],
})
export class AppModule {}
```

```ts
// product-detail.module.ts
@NgModule({
  declarations: [ProductDetailComponent],
  imports: [CommonModule, RouterModule, RecentlyVisitedModule], // 👈 Also uses RecentlyVisitedModule
  exports: [ProductDetailComponent],
})
export class ProductDetailModule {}
```

```ts
@NgModule({
  declarations: [RecentlyVisitedComponent],
  imports: [CommonModule],
  exports: [RecentlyVisitedComponent],
  providers: [RecentlyVisitedService], // 👈 Provides the service
})
export class RecentlyVisitedModule {}
```

**What happens here?** Even though `RecentlyVisitedModule` is imported in multiple places (both `AppModule` and `ProductDetailModule`), Angular creates **only one injector** for the entire application when everything is eagerly loaded. All providers from all eagerly loaded modules get merged into this root injector.

**Result:** You get a singleton. Both `HomeComponent` and `ProductDetailComponent` receive the same instance of `RecentlyVisitedService`. When you visit a product, it gets added to the list, and when you navigate back to home, the list is still there. ✅ Everything works perfectly.

![image of project structure where modules are imported eagerly](../../assets/blog-module-eager.jpg)

## Scenario 2: Lazy Loading (Everything Breaks)

Now, let's say you want to improve performance by lazy loading the product detail page. You make what seems like a simple change to the routes:

```ts
// app.routes.ts
export const routes: Routes = [
  { path: "", component: HomeComponent },
  {
    path: "product/:id",
    loadChildren: () =>
      import("./product-detail/product-detail.module").then(
        (m) => m.ProductDetailModule
      ),
  },
];
```

The build succeeds. TypeScript is happy. You run the app and... it's broken.

When you click on a coffee to view its details, the product page loads fine. But when you navigate back to the home page, the "Recently Visited" section is empty. It's as if the app forgot you just viewed that product.

![image of the webshop home page with recently visited section empty/not working](../../assets/blog-modules-home.jpg)
![image of the web shop product page with recently visited section working](../../assets/blog-modules-product.jpg)

**What went wrong?**

When you lazy load the `ProductDetailModule`, Angular creates a **child injector** specifically for that lazy-loaded bundle. This child injector is separate from the root injector.

Here's the critical part: When `ProductDetailModule` imports `RecentlyVisitedModule`, and that module has `providers: [RecentlyVisitedService]`, Angular creates a **new instance** of `RecentlyVisitedService` in the child injector.

Now you have:

- **Instance #1** in the root injector (used by `HomeComponent`)
- **Instance #2** in the lazy module's child injector (used by `ProductDetailComponent`)

Each instance has its own `BehaviorSubject`, its own state, its own memory. They're completely isolated from each other.

![image of project structure where modules are imported lazily](../../assets/blog-module-lazy.jpg)

## Why This Is So Dangerous

The scariest part about this bug is that **there are no errors**. Your code compiles. Your tests might even pass (if they don't test cross-module interactions). The app runs without throwing exceptions.

The only symptom is that your app behaves incorrectly at runtime. Features that rely on shared state—like caching, user preferences, shopping carts, or in my case, recently visited items—silently break.

This is particularly insidious when refactoring:

1. **Your code worked before** (with eager loading)
2. **You make a "safe" performance optimization** (add lazy loading)
3. **The build succeeds** (no TypeScript errors)
4. **The app breaks** (but only at runtime, in subtle ways)

## Understanding NgModules and Injector Hierarchy

Before standalone components, Angular applications were built with NgModules—essentially LEGO boxes that bundled related functionality together.

**The good parts:**

- **Encapsulation**: A module could bundle a component, its template, styles, pipes, and services all in one place
- **Portability**: Import `UserModule` and get everything you need—no need to import 10 different files
- **Mental model**: Modules provided clear boundaries: "This is the Billing feature," "This is the Search feature"

**The Caveat: The "Providers" Trap**

In an NgModule, there's a massive conceptual difference between `declarations` (components/pipes) and `providers` (services):

- **Declarations are scoped**: If Module A declares a component, Module B cannot see it unless Module A exports it and Module B imports A. They stay in their "box."

- **Providers are (mostly) global**: Angular tried to be helpful by flattening providers. If you imported a module that had providers, Angular would usually merge those providers into the root injector so everyone could share them.

**...Until lazy loading enters the chat.**

The moment a module is lazy loaded, Angular draws a hard line in the sand. It creates a **child injector** (a separate dependency container) for that lazy module. Any providers declared in modules imported by the lazy module get instantiated in this child injector, creating new instances.

## The Solutions

Once you understand the problem, there are several ways to fix it:

### Solution 1: Use `providedIn: 'root'`

The modern, recommended approach is to use the `providedIn` metadata in the `@Injectable` decorator:

```ts
@Injectable({
  providedIn: "root", // 👈 Ensures singleton across the entire app
})
export class RecentlyVisitedService {
  // ... implementation
}
```

Then **remove** the service from the module's `providers` array:

```ts
@NgModule({
  declarations: [RecentlyVisitedComponent],
  imports: [CommonModule],
  exports: [RecentlyVisitedComponent],
  // providers: [RecentlyVisitedService], // ❌ Remove this!
})
export class RecentlyVisitedModule {}
```

**Why this works:** When you use `providedIn: 'root'`, Angular registers the service in the root injector directly, bypassing the module system entirely. This guarantees a singleton regardless of how modules are loaded.

**Benefits:**

- Tree-shakable (unused services can be removed by the bundler)
- Works with both eager and lazy loading
- The modern Angular way

### Solution 2: Use `forRoot()` Pattern

If you need to keep the service in the module (for example, if you need to configure it), use the `forRoot()` pattern:

```ts
@NgModule({
  declarations: [RecentlyVisitedComponent],
  imports: [CommonModule],
  exports: [RecentlyVisitedComponent],
})
export class RecentlyVisitedModule {
  static forRoot(): ModuleWithProviders<RecentlyVisitedModule> {
    return {
      ngModule: RecentlyVisitedModule,
      providers: [RecentlyVisitedService],
    };
  }
}
```

Then import it in your `AppModule` using `forRoot()`:

```ts
@NgModule({
  declarations: [App, HomeComponent],
  imports: [
    BrowserModule,
    RouterModule.forRoot(routes),
    RecentlyVisitedModule.forRoot(), // 👈 Only call forRoot() in AppModule
  ],
  bootstrap: [App],
})
export class AppModule {}
```

And in lazy-loaded modules, import it **without** `forRoot()`:

```ts
@NgModule({
  declarations: [ProductDetailComponent],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    RecentlyVisitedModule, // 👈 No forRoot() here!
  ],
})
export class ProductDetailModule {}
```

**Why this works:** The `forRoot()` method returns the providers only when called. By convention, you only call it once in the root module. Lazy modules import the module without providers, so they use the existing instance from the root injector.

### Solution 3: Migrate to Standalone Components

The ultimate solution is to migrate away from NgModules entirely:

```ts
@Component({
  selector: "app-product-detail",
  standalone: true,
  imports: [CommonModule, RecentlyVisitedComponent],
  templateUrl: "./product-detail.component.html",
})
export class ProductDetailComponent {
  constructor(private recentlyVisitedService: RecentlyVisitedService) {}
}
```

With standalone components and `providedIn: 'root'`, you don't have to worry about module boundaries or injector hierarchies. Services are always singletons unless you explicitly provide them at the component level.

## Key Takeaways

🚨 **The Refactoring Trap:**

- **Eagerly loaded modules**: Providers are merged into the root injector → you get a singleton
- **Lazy-loaded modules**: Angular creates a child injector for the lazy bundle → if that module provides the same service, you get a new instance

⚠️ **This is why refactoring from eager to lazy loading can suddenly break your app**—the same code that worked before now creates multiple instances!

✅ **Best Practices:**

1. Always use `providedIn: 'root'` for singleton services
2. If using NgModules, use the `forRoot()` pattern for shared services
3. Consider migrating to standalone components to avoid these issues entirely
4. Test your app thoroughly after changing lazy loading boundaries

## Conclusion

Angular's injector hierarchy is powerful but can be confusing, especially when working with NgModules. The difference between eager and lazy loading creates a subtle trap that can break your app without any compile-time warnings.

The good news is that modern Angular has better solutions. With `providedIn: 'root'` and standalone components, you can avoid these pitfalls entirely. But if you're working with a legacy codebase that still uses NgModules, understanding how injector hierarchies work is crucial.

Next time you refactor routes to use lazy loading, remember: **check your services**. Make sure they're using `providedIn: 'root'` or the `forRoot()` pattern. Your future self (and your users) will thank you.

---

**Resources:**

- [Angular Dependency Injection Guide](https://v19.angular.dev/guide/di)
- [Hierarchical Injectors](https://v19.angular.dev/guide/di/hierarchical-dependency-injection)
- [Standalone Components](https://v19.angular.dev/guide/components/importing)
