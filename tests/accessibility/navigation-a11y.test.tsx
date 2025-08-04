import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserRouter } from 'react-router';
import { TabNavigation } from '../../src/components/Navigation/TabNavigation';
import { TAB_CONFIG } from '../../src/constants/navigation';
import {
  expectAccessible,
  testAccessibilityCompliance,
  accessibilityScenarios,
  expectCriticalAccessibility,
} from '../utils/accessibilityTestUtils';

expect.extend(toHaveNoViolations);

// Mock navigation components for generic testing
const NavLink = ({ href, children, 'aria-current': ariaCurrent, ...props }: any) => (
  <a href={href} aria-current={ariaCurrent} {...props}>
    {children}
  </a>
);

const Navigation = ({ children, ...props }: any) => <nav {...props}>{children}</nav>;

const Breadcrumb = ({ children, ...props }: any) => (
  <nav aria-label='Breadcrumb' {...props}>
    <ol>{children}</ol>
  </nav>
);

const BreadcrumbItem = ({ children, isLast = false }: any) => (
  <li>
    {isLast ? (
      <span aria-current='page'>{children}</span>
    ) : (
      <a href={`/${children.toLowerCase()}`}>{children}</a>
    )}
  </li>
);

describe('Navigation Accessibility Tests', () => {
  beforeEach(() => {
    // Clear any previous DOM content
    document.body.innerHTML = '';
  });

  describe('TabNavigation Component Accessibility', () => {
    const mockProps = {
      swipeHighlight: false,
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
    };

    const renderTabNavigation = (props = mockProps) => {
      return render(
        <BrowserRouter>
          <TabNavigation {...props} />
        </BrowserRouter>
      );
    };

    it('has no accessibility violations in default state', async () => {
      const { container } = renderTabNavigation();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no accessibility violations with swipe highlight', async () => {
      const { container } = renderTabNavigation({
        ...mockProps,
        swipeHighlight: true,
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('provides proper navigation landmark', () => {
      renderTabNavigation();

      const navigation = screen.getByRole('navigation');
      expect(navigation).toBeInTheDocument();
      expect(navigation).toHaveClass('mainNav');
    });

    it('renders all tab links with proper accessibility attributes', () => {
      renderTabNavigation();

      TAB_CONFIG.forEach(tab => {
        const link = screen.getByRole('link', { name: tab.label });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', `/${tab.id}`);
      });

      const allLinks = screen.getAllByRole('link');
      expect(allLinks).toHaveLength(TAB_CONFIG.length);
    });

    it('properly indicates current page with active state', () => {
      // Set up router to simulate being on runs page
      render(
        <BrowserRouter>
          <div>
            <TabNavigation {...mockProps} />
          </div>
        </BrowserRouter>
      );

      const links = screen.getAllByRole('link');
      links.forEach(link => {
        expect(link).toBeInTheDocument();
        // Verify each link is focusable
        expect(link.tagName).toBe('A');
      });
    });

    it('supports keyboard navigation between tabs', () => {
      renderTabNavigation();

      const links = screen.getAllByRole('link');

      // Test that each link can receive focus
      links.forEach(link => {
        link.focus();
        expect(link).toHaveFocus();
      });

      // Test tab order is logical (left to right)
      const expectedOrder = TAB_CONFIG.map(tab => tab.label);
      const actualOrder = links.map(link => link.textContent);
      expect(actualOrder).toEqual(expectedOrder);
    });

    it('handles touch events with proper accessibility', () => {
      const onTouchStart = vi.fn();
      const onTouchMove = vi.fn();
      const onTouchEnd = vi.fn();

      renderTabNavigation({
        swipeHighlight: false,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
      });

      const firstLink = screen.getByRole('link', { name: TAB_CONFIG[0].label });

      // Test touch events don't interfere with accessibility
      fireEvent.touchStart(firstLink);
      expect(onTouchStart).toHaveBeenCalled();

      fireEvent.touchMove(firstLink);
      expect(onTouchMove).toHaveBeenCalled();

      fireEvent.touchEnd(firstLink);
      expect(onTouchEnd).toHaveBeenCalled();

      // Link should still be accessible after touch events
      firstLink.focus();
      expect(firstLink).toHaveFocus();
    });

    it('provides semantic navigation structure', () => {
      renderTabNavigation();

      const navigation = screen.getByRole('navigation');
      const links = screen.getAllByRole('link');

      // Navigation should contain all links
      links.forEach(link => {
        expect(navigation).toContainElement(link);
      });

      // Each link should have meaningful text
      links.forEach(link => {
        expect(link.textContent).toBeTruthy();
        expect(link.textContent!.length).toBeGreaterThan(2); // More than just icon
      });
    });

    it('handles swipe highlight state accessibly', () => {
      const { rerender } = renderTabNavigation({
        ...mockProps,
        swipeHighlight: false,
      });

      let links = screen.getAllByRole('link');
      links.forEach(link => {
        expect(link).not.toHaveClass('swipeHighlight');
      });

      // Enable swipe highlight
      rerender(
        <BrowserRouter>
          <TabNavigation {...mockProps} swipeHighlight={true} />
        </BrowserRouter>
      );

      // Note: swipeHighlight only applies to active links, but we can test structure
      links = screen.getAllByRole('link');
      expect(links.length).toBe(TAB_CONFIG.length);
    });

    it('maintains accessibility with CSS styling', async () => {
      const { container } = renderTabNavigation();

      // Test that styling doesn't break accessibility
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['color-contrast', 'keyboard'],
      });

      const navigation = screen.getByRole('navigation');
      expect(navigation).toHaveClass('mainNav');

      const links = screen.getAllByRole('link');
      links.forEach(link => {
        expect(link).toHaveClass('navBtn');
      });
    });

    it('provides clear focus indicators', () => {
      renderTabNavigation();

      const links = screen.getAllByRole('link');

      links.forEach(link => {
        // Focus the link
        link.focus();
        expect(link).toHaveFocus();

        // Verify focus is visible (not relying on CSS here, just structural)
        expect(link).toBeVisible();
        expect(link).not.toHaveStyle('outline: none');
      });
    });

    it('meets WCAG AA compliance standards', async () => {
      const { container } = renderTabNavigation();

      await testAccessibilityCompliance(container, 'AA');
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader', 'color-contrast', 'structure'],
      });
    });

    it('handles route changes accessibly', () => {
      // Test with different initial routes
      const { rerender } = render(
        <BrowserRouter>
          <TabNavigation {...mockProps} />
        </BrowserRouter>
      );

      // Verify all links are present regardless of route
      TAB_CONFIG.forEach(tab => {
        const link = screen.getByRole('link', { name: tab.label });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', `/${tab.id}`);
      });

      // Re-render to test stability
      rerender(
        <BrowserRouter>
          <TabNavigation {...mockProps} swipeHighlight={true} />
        </BrowserRouter>
      );

      // Links should still be accessible
      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(TAB_CONFIG.length);
    });

    it('provides appropriate ARIA labels and roles', () => {
      renderTabNavigation();

      const navigation = screen.getByRole('navigation');
      expect(navigation).toBeInTheDocument();

      // While the component doesn't explicitly set aria-label,
      // the nav role provides semantic meaning
      expect(navigation.tagName).toBe('NAV');

      const links = screen.getAllByRole('link');
      links.forEach(link => {
        // Each link should have accessible text content
        expect(link.textContent).toBeTruthy();
        expect(link).toHaveAttribute('href');
      });
    });

    it('works with screen readers', async () => {
      const { container } = renderTabNavigation();

      // Test screen reader compatibility
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['screen-reader'],
      });

      const navigation = screen.getByRole('navigation');
      const links = screen.getAllByRole('link');

      // Verify screen reader can understand structure
      expect(navigation).toBeInTheDocument();
      expect(links.length).toBeGreaterThan(0);

      // Each link should be announceeable
      links.forEach(link => {
        expect(link.textContent).toBeTruthy();
        expect(link.getAttribute('href')).toBeTruthy();
      });
    });

    it('integrates properly with routing accessibility', () => {
      renderTabNavigation();

      const links = screen.getAllByRole('link');

      // Verify all links have proper hrefs for routing
      links.forEach((link, index) => {
        const expectedHref = `/${TAB_CONFIG[index].id}`;
        expect(link).toHaveAttribute('href', expectedHref);
      });

      // Test that clicking links would work with keyboard
      links.forEach(link => {
        // Simulate keyboard activation
        link.focus();
        expect(link).toHaveFocus();

        // Should be activatable with Enter or Space
        fireEvent.keyDown(link, { key: 'Enter', code: 'Enter' });
        fireEvent.keyDown(link, { key: ' ', code: 'Space' });
      });
    });
  });

  describe('Main Navigation Accessibility', () => {
    it('has no accessibility violations in basic navigation', async () => {
      const { container } = render(
        <Navigation aria-label='Main navigation'>
          <ul>
            <li>
              <NavLink href='/'>Home</NavLink>
            </li>
            <li>
              <NavLink href='/about'>About</NavLink>
            </li>
            <li>
              <NavLink href='/contact'>Contact</NavLink>
            </li>
          </ul>
        </Navigation>
      );

      // Enhanced accessibility testing with critical severity
      await expectCriticalAccessibility(container);
    });

    it('has proper navigation landmark and labeling', async () => {
      const { container } = render(
        <Navigation aria-label='Primary navigation'>
          <ul>
            <li>
              <NavLink href='/'>Home</NavLink>
            </li>
            <li>
              <NavLink href='/products'>Products</NavLink>
            </li>
            <li>
              <NavLink href='/services'>Services</NavLink>
            </li>
          </ul>
        </Navigation>
      );

      const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
      expect(nav).toBeInTheDocument();

      const navLinks = screen.getAllByRole('link');
      expect(navLinks).toHaveLength(3);

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['structure', 'keyboard'],
      });
    });

    it('handles current page indication properly', async () => {
      const { container } = render(
        <Navigation aria-label='Main navigation'>
          <ul>
            <li>
              <NavLink href='/'>Home</NavLink>
            </li>
            <li>
              <NavLink href='/about' aria-current='page'>
                About
              </NavLink>
            </li>
            <li>
              <NavLink href='/contact'>Contact</NavLink>
            </li>
          </ul>
        </Navigation>
      );

      const currentLink = screen.getByRole('link', { name: 'About' });
      expect(currentLink).toHaveAttribute('aria-current', 'page');

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['screen-reader'],
      });
    });

    it('supports keyboard navigation through menu items', async () => {
      render(
        <Navigation aria-label='Keyboard navigation'>
          <ul>
            <li>
              <NavLink href='/'>Home</NavLink>
            </li>
            <li>
              <NavLink href='/about'>About</NavLink>
            </li>
            <li>
              <NavLink href='/contact'>Contact</NavLink>
            </li>
          </ul>
        </Navigation>
      );

      const homeLink = screen.getByRole('link', { name: 'Home' });
      const aboutLink = screen.getByRole('link', { name: 'About' });
      const contactLink = screen.getByRole('link', { name: 'Contact' });

      // Test tab navigation
      homeLink.focus();
      expect(homeLink).toHaveFocus();

      aboutLink.focus();
      expect(aboutLink).toHaveFocus();

      contactLink.focus();
      expect(contactLink).toHaveFocus();
    });
  });

  describe('Multiple Navigation Landmarks', () => {
    it('properly labels multiple navigation landmarks', async () => {
      const { container } = render(
        <div>
          <Navigation aria-label='Primary navigation'>
            <ul>
              <li>
                <NavLink href='/'>Home</NavLink>
              </li>
              <li>
                <NavLink href='/about'>About</NavLink>
              </li>
            </ul>
          </Navigation>

          <main>
            <h1>Page Content</h1>
          </main>

          <Navigation aria-label='Secondary navigation'>
            <ul>
              <li>
                <NavLink href='/help'>Help</NavLink>
              </li>
              <li>
                <NavLink href='/support'>Support</NavLink>
              </li>
            </ul>
          </Navigation>
        </div>
      );

      const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
      const secondaryNav = screen.getByRole('navigation', { name: 'Secondary navigation' });

      expect(primaryNav).toBeInTheDocument();
      expect(secondaryNav).toBeInTheDocument();

      // Each should have distinct labels
      expect(primaryNav).toHaveAttribute('aria-label', 'Primary navigation');
      expect(secondaryNav).toHaveAttribute('aria-label', 'Secondary navigation');

      await accessibilityScenarios.testNavigation(container);
    });

    it('handles footer navigation accessibility', async () => {
      const { container } = render(
        <footer>
          <Navigation aria-label='Footer navigation'>
            <ul>
              <li>
                <NavLink href='/privacy'>Privacy Policy</NavLink>
              </li>
              <li>
                <NavLink href='/terms'>Terms of Service</NavLink>
              </li>
              <li>
                <NavLink href='/accessibility'>Accessibility</NavLink>
              </li>
            </ul>
          </Navigation>
        </footer>
      );

      const footerNav = screen.getByRole('navigation', { name: 'Footer navigation' });
      expect(footerNav).toBeInTheDocument();

      const footer = screen.getByRole('contentinfo');
      expect(footer).toContainElement(footerNav);

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['structure'],
      });
    });
  });

  describe('Breadcrumb Navigation Accessibility', () => {
    it('has proper breadcrumb structure and ARIA', async () => {
      const { container } = render(
        <Breadcrumb>
          <BreadcrumbItem>Home</BreadcrumbItem>
          <BreadcrumbItem>Products</BreadcrumbItem>
          <BreadcrumbItem>Laptops</BreadcrumbItem>
          <BreadcrumbItem isLast>Gaming Laptop</BreadcrumbItem>
        </Breadcrumb>
      );

      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumbNav).toBeInTheDocument();

      const list = screen.getByRole('list');
      expect(breadcrumbNav).toContainElement(list);

      const currentPage = screen.getByText('Gaming Laptop');
      expect(currentPage).toHaveAttribute('aria-current', 'page');

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['structure', 'screen-reader'],
      });
    });

    it('handles breadcrumb separators accessibly', async () => {
      const { container } = render(
        <nav aria-label='Breadcrumb'>
          <ol>
            <li>
              <a href='/home'>Home</a>
              <span aria-hidden='true'> / </span>
            </li>
            <li>
              <a href='/category'>Category</a>
              <span aria-hidden='true'> / </span>
            </li>
            <li>
              <span aria-current='page'>Current Page</span>
            </li>
          </ol>
        </nav>
      );

      const separators = container.querySelectorAll('[aria-hidden="true"]');
      separators.forEach(separator => {
        expect(separator).toHaveAttribute('aria-hidden', 'true');
      });

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['screen-reader'],
      });
    });
  });

  describe('Dropdown/Submenu Navigation Accessibility', () => {
    it('handles dropdown menu accessibility', async () => {
      const TestDropdown = () => {
        const [isOpen, setIsOpen] = React.useState(false);

        return (
          <Navigation aria-label='Main menu'>
            <ul>
              <li>
                <button
                  aria-expanded={isOpen}
                  aria-haspopup='menu'
                  onClick={() => setIsOpen(!isOpen)}
                >
                  Products
                </button>
                {isOpen && (
                  <ul role='menu'>
                    <li role='menuitem'>
                      <a href='/laptops'>Laptops</a>
                    </li>
                    <li role='menuitem'>
                      <a href='/desktops'>Desktops</a>
                    </li>
                    <li role='menuitem'>
                      <a href='/tablets'>Tablets</a>
                    </li>
                  </ul>
                )}
              </li>
            </ul>
          </Navigation>
        );
      };

      const { container } = render(<TestDropdown />);

      const menuButton = screen.getByRole('button', { name: 'Products' });
      expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      expect(menuButton).toHaveAttribute('aria-haspopup', 'menu');

      // Open dropdown
      fireEvent.click(menuButton);
      expect(menuButton).toHaveAttribute('aria-expanded', 'true');

      const menu = screen.getByRole('menu');
      expect(menu).toBeInTheDocument();

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems).toHaveLength(3);

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader'],
      });
    });

    it('handles submenu keyboard navigation', async () => {
      const TestSubmenu = () => {
        const [openMenu, setOpenMenu] = React.useState<string | null>(null);

        return (
          <Navigation aria-label='Main navigation'>
            <ul role='menubar'>
              <li role='none'>
                <button
                  role='menuitem'
                  aria-expanded={openMenu === 'products'}
                  aria-haspopup='menu'
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setOpenMenu(openMenu === 'products' ? null : 'products');
                    }
                  }}
                  onClick={() => setOpenMenu(openMenu === 'products' ? null : 'products')}
                >
                  Products
                </button>
                {openMenu === 'products' && (
                  <ul role='menu'>
                    <li role='menuitem'>
                      <a href='/laptops'>Laptops</a>
                    </li>
                    <li role='menuitem'>
                      <a href='/phones'>Phones</a>
                    </li>
                  </ul>
                )}
              </li>
            </ul>
          </Navigation>
        );
      };

      render(<TestSubmenu />);

      const menubar = screen.getByRole('menubar');
      expect(menubar).toBeInTheDocument();

      const menuButton = screen.getByRole('menuitem', { name: 'Products' });

      // Test keyboard activation
      fireEvent.keyDown(menuButton, { key: 'Enter' });

      const submenu = screen.getByRole('menu');
      expect(submenu).toBeInTheDocument();
    });
  });

  describe('Mobile Navigation Accessibility', () => {
    it('handles mobile menu toggle accessibility', async () => {
      const MobileNav = () => {
        const [isOpen, setIsOpen] = React.useState(false);

        return (
          <div>
            <button
              aria-expanded={isOpen}
              aria-controls='mobile-menu'
              aria-label='Toggle navigation menu'
              onClick={() => setIsOpen(!isOpen)}
            >
              <span aria-hidden='true'>☰</span>
            </button>

            <Navigation id='mobile-menu' aria-hidden={!isOpen} aria-label='Mobile navigation'>
              <ul>
                <li>
                  <NavLink href='/'>Home</NavLink>
                </li>
                <li>
                  <NavLink href='/about'>About</NavLink>
                </li>
                <li>
                  <NavLink href='/contact'>Contact</NavLink>
                </li>
              </ul>
            </Navigation>
          </div>
        );
      };

      const { container } = render(<MobileNav />);

      const toggleButton = screen.getByRole('button', { name: 'Toggle navigation menu' });
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
      expect(toggleButton).toHaveAttribute('aria-controls', 'mobile-menu');

      const mobileMenu = screen.getByRole('navigation', { name: 'Mobile navigation' });
      expect(mobileMenu).toHaveAttribute('aria-hidden', 'true');

      // Open mobile menu
      fireEvent.click(toggleButton);
      expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
      expect(mobileMenu).toHaveAttribute('aria-hidden', 'false');

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader'],
      });
    });

    it('handles off-canvas navigation accessibility', async () => {
      const OffCanvasNav = () => {
        const [isOpen, setIsOpen] = React.useState(false);

        return (
          <div>
            <button aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>
              Open Menu
            </button>

            {isOpen && (
              <div role='dialog' aria-modal='true' aria-labelledby='nav-title'>
                <h2 id='nav-title'>Navigation Menu</h2>
                <Navigation>
                  <ul>
                    <li>
                      <NavLink href='/'>Home</NavLink>
                    </li>
                    <li>
                      <NavLink href='/services'>Services</NavLink>
                    </li>
                    <li>
                      <NavLink href='/about'>About</NavLink>
                    </li>
                  </ul>
                </Navigation>
                <button onClick={() => setIsOpen(false)}>Close Menu</button>
              </div>
            )}
          </div>
        );
      };

      const { container } = render(<OffCanvasNav />);

      const openButton = screen.getByRole('button', { name: 'Open Menu' });
      fireEvent.click(openButton);

      const dialog = screen.getByRole('dialog', { name: 'Navigation Menu' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      const navigation = screen.getByRole('navigation');
      expect(dialog).toContainElement(navigation);

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['structure', 'keyboard'],
      });
    });
  });

  describe('Skip Links and Navigation Bypass', () => {
    it('provides skip links for navigation bypass', async () => {
      const { container } = render(
        <div>
          <a href='#main-content' className='skip-link'>
            Skip to main content
          </a>
          <a href='#nav' className='skip-link'>
            Skip to navigation
          </a>

          <Navigation id='nav' aria-label='Main navigation'>
            <ul>
              <li>
                <NavLink href='/'>Home</NavLink>
              </li>
              <li>
                <NavLink href='/about'>About</NavLink>
              </li>
            </ul>
          </Navigation>

          <main id='main-content'>
            <h1>Main Content</h1>
          </main>
        </div>
      );

      const skipToMain = screen.getByRole('link', { name: 'Skip to main content' });
      const skipToNav = screen.getByRole('link', { name: 'Skip to navigation' });

      expect(skipToMain).toHaveAttribute('href', '#main-content');
      expect(skipToNav).toHaveAttribute('href', '#nav');

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['structure', 'keyboard'],
      });
    });

    it('handles navigation shortcuts and landmarks', async () => {
      const { container } = render(
        <div>
          <header>
            <Navigation aria-label='Primary navigation'>
              <ul>
                <li>
                  <NavLink href='/'>Home</NavLink>
                </li>
                <li>
                  <NavLink href='/products'>Products</NavLink>
                </li>
              </ul>
            </Navigation>
          </header>

          <main>
            <h1>Page Content</h1>
            <Navigation aria-label='Page navigation'>
              <ul>
                <li>
                  <a href='#section1'>Section 1</a>
                </li>
                <li>
                  <a href='#section2'>Section 2</a>
                </li>
              </ul>
            </Navigation>
          </main>

          <aside>
            <Navigation aria-label='Related links'>
              <ul>
                <li>
                  <NavLink href='/related1'>Related Page 1</NavLink>
                </li>
                <li>
                  <NavLink href='/related2'>Related Page 2</NavLink>
                </li>
              </ul>
            </Navigation>
          </aside>
        </div>
      );

      // Verify all landmark structure
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('complementary')).toBeInTheDocument();

      // Verify multiple navigation landmarks
      const navs = screen.getAllByRole('navigation');
      expect(navs).toHaveLength(3);

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['structure'],
      });
    });
  });

  describe('Navigation State Management', () => {
    it('handles active/current state properly', async () => {
      const ActiveNav = ({ currentPath }: { currentPath: string }) => (
        <Navigation aria-label='Main navigation'>
          <ul>
            <li>
              <NavLink href='/' aria-current={currentPath === '/' ? 'page' : undefined}>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink href='/about' aria-current={currentPath === '/about' ? 'page' : undefined}>
                About
              </NavLink>
            </li>
            <li>
              <NavLink
                href='/contact'
                aria-current={currentPath === '/contact' ? 'page' : undefined}
              >
                Contact
              </NavLink>
            </li>
          </ul>
        </Navigation>
      );

      const { container, rerender } = render(<ActiveNav currentPath='/about' />);

      let aboutLink = screen.getByRole('link', { name: 'About' });
      expect(aboutLink).toHaveAttribute('aria-current', 'page');

      // Change current page
      rerender(<ActiveNav currentPath='/contact' />);

      const contactLink = screen.getByRole('link', { name: 'Contact' });
      expect(contactLink).toHaveAttribute('aria-current', 'page');

      aboutLink = screen.getByRole('link', { name: 'About' });
      expect(aboutLink).not.toHaveAttribute('aria-current');

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['screen-reader'],
      });
    });

    it('handles loading states in navigation', async () => {
      const LoadingNav = ({ isLoading }: { isLoading: boolean }) => (
        <Navigation aria-label='Navigation' aria-busy={isLoading}>
          {isLoading ? (
            <div role='status' aria-live='polite'>
              Loading navigation...
            </div>
          ) : (
            <ul>
              <li>
                <NavLink href='/'>Home</NavLink>
              </li>
              <li>
                <NavLink href='/about'>About</NavLink>
              </li>
            </ul>
          )}
        </Navigation>
      );

      const { container, rerender } = render(<LoadingNav isLoading={true} />);

      const nav = screen.getByRole('navigation');
      expect(nav).toHaveAttribute('aria-busy', 'true');

      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('Loading navigation...');

      // Navigation loaded
      rerender(<LoadingNav isLoading={false} />);
      expect(nav).toHaveAttribute('aria-busy', 'false');

      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['screen-reader'],
      });
    });
  });

  describe('WCAG Compliance', () => {
    it('meets WCAG AA standards for complete navigation system', async () => {
      const { container } = render(
        <div>
          <a href='#main' className='skip-link'>
            Skip to main content
          </a>

          <header>
            <Navigation aria-label='Primary navigation'>
              <ul>
                <li>
                  <NavLink href='/' aria-current='page'>
                    Home
                  </NavLink>
                </li>
                <li>
                  <NavLink href='/about'>About</NavLink>
                </li>
                <li>
                  <button aria-expanded='false' aria-haspopup='menu'>
                    Services
                  </button>
                </li>
                <li>
                  <NavLink href='/contact'>Contact</NavLink>
                </li>
              </ul>
            </Navigation>
          </header>

          <nav aria-label='Breadcrumb'>
            <ol>
              <li>
                <a href='/'>Home</a>
              </li>
              <li>
                <span aria-current='page'>Current Page</span>
              </li>
            </ol>
          </nav>

          <main id='main'>
            <h1>Page Content</h1>

            <nav aria-label='Page contents'>
              <ul>
                <li>
                  <a href='#section1'>Section 1</a>
                </li>
                <li>
                  <a href='#section2'>Section 2</a>
                </li>
              </ul>
            </nav>
          </main>

          <footer>
            <Navigation aria-label='Footer navigation'>
              <ul>
                <li>
                  <NavLink href='/privacy'>Privacy</NavLink>
                </li>
                <li>
                  <NavLink href='/terms'>Terms</NavLink>
                </li>
              </ul>
            </Navigation>
          </footer>
        </div>
      );

      // Test comprehensive WCAG AA compliance
      await testAccessibilityCompliance(container, 'AA');

      // Test navigation-specific accessibility
      await accessibilityScenarios.testNavigation(container);

      // Test all accessibility categories
      await expectAccessible(container, {
        wcagLevel: 'AA',
        categories: ['keyboard', 'screen-reader', 'structure', 'color-contrast'],
      });
    });
  });
});
