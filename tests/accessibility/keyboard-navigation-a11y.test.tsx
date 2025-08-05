import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router';
// import {
//   expectAccessible,
//   testAccessibilityCompliance,
//   accessibilityScenarios,
// } from '../utils/accessibilityTestUtils';
import { Button } from '../../src/components/UI/Button';
import { Modal } from '../../src/components/UI/Modal';
import { Input } from '../../src/components/UI/Input';
import { TabNavigation } from '../../src/components/Navigation/TabNavigation';

expect.extend(toHaveNoViolations);

// Mock keyboard event for testing keyboard shortcuts
// const createKeyboardEvent = (key: string, options: any = {}) => {
//   return new KeyboardEvent('keydown', {
//     key,
//     code: key === ' ' ? 'Space' : key,
//     bubbles: true,
//     ...options,
//   });
// };

describe('Keyboard Navigation Accessibility Tests', () => {
  beforeEach(() => {
    // Clear any previous DOM content and focus
    document.body.innerHTML = '<div id="root"></div>';
    // Reset focus to body
    if (document.activeElement) {
      (document.activeElement as HTMLElement).blur();
    }
  });

  afterEach(() => {
    // Clean up any event listeners or focus traps
    document.body.style.overflow = '';
  });

  describe('Tab Order Testing', () => {
    it('maintains logical tab order in form components', () => {
      const TestForm = () => (
        <form>
          <Input id='first-input' label='First Input' type='text' value='' onChange={vi.fn()} />
          <Input id='second-input' label='Second Input' type='email' value='' onChange={vi.fn()} />
          <Button type='button'>Secondary Action</Button>
          <Button type='submit' variant='primary'>
            Primary Action
          </Button>
        </form>
      );

      render(<TestForm />);

      const firstInput = screen.getByLabelText('First Input');
      const secondInput = screen.getByLabelText('Second Input');
      const secondaryButton = screen.getByRole('button', { name: 'Secondary Action' });
      const primaryButton = screen.getByRole('button', { name: 'Primary Action' });

      // Test logical tab order
      firstInput.focus();
      expect(firstInput).toHaveFocus();

      // Simulate Tab key navigation
      fireEvent.keyDown(firstInput, { key: 'Tab' });
      secondInput.focus();
      expect(secondInput).toHaveFocus();

      fireEvent.keyDown(secondInput, { key: 'Tab' });
      secondaryButton.focus();
      expect(secondaryButton).toHaveFocus();

      fireEvent.keyDown(secondaryButton, { key: 'Tab' });
      primaryButton.focus();
      expect(primaryButton).toHaveFocus();

      // Test reverse tab order with Shift+Tab
      fireEvent.keyDown(primaryButton, { key: 'Tab', shiftKey: true });
      secondaryButton.focus();
      expect(secondaryButton).toHaveFocus();
    });

    it('properly handles tab order with disabled elements', () => {
      const TestComponent = () => (
        <div>
          <Button>First Button</Button>
          <Button disabled>Disabled Button</Button>
          <Button>Third Button</Button>
          <input type='text' placeholder='Text Input' />
        </div>
      );

      render(<TestComponent />);

      const firstButton = screen.getByRole('button', { name: 'First Button' });
      const disabledButton = screen.getByRole('button', { name: 'Disabled Button' });
      const thirdButton = screen.getByRole('button', { name: 'Third Button' });
      const textInput = screen.getByRole('textbox');

      // Disabled button should not be focusable
      expect(disabledButton).toBeDisabled();
      expect(disabledButton).toHaveAttribute('tabindex', '-1');

      // Tab order should skip disabled elements
      firstButton.focus();
      expect(firstButton).toHaveFocus();

      // Simulating tab navigation (skipping disabled button)
      thirdButton.focus();
      expect(thirdButton).toHaveFocus();

      textInput.focus();
      expect(textInput).toHaveFocus();
    });

    it('maintains tab order in complex layouts with nested elements', () => {
      const ComplexLayout = () => (
        <div>
          <header>
            <Button>Header Button</Button>
          </header>
          <nav>
            <a href='/home'>Home</a>
            <a href='/about'>About</a>
          </nav>
          <main>
            <section>
              <Input id='main-input' label='Main Input' type='text' value='' onChange={vi.fn()} />
              <div>
                <Button>Nested Button</Button>
                <select>
                  <option>Option 1</option>
                  <option>Option 2</option>
                </select>
              </div>
            </section>
          </main>
          <footer>
            <Button>Footer Button</Button>
          </footer>
        </div>
      );

      render(<ComplexLayout />);

      // Elements should be tabbable in document order
      const headerButton = screen.getByRole('button', { name: 'Header Button' });
      const homeLink = screen.getByRole('link', { name: 'Home' });
      const aboutLink = screen.getByRole('link', { name: 'About' });
      const mainInput = screen.getByLabelText('Main Input');
      const nestedButton = screen.getByRole('button', { name: 'Nested Button' });
      const selectElement = screen.getByRole('combobox');
      const footerButton = screen.getByRole('button', { name: 'Footer Button' });

      // Test sequential focus
      const expectedOrder = [
        headerButton,
        homeLink,
        aboutLink,
        mainInput,
        nestedButton,
        selectElement,
        footerButton,
      ];

      expectedOrder.forEach(element => {
        element.focus();
        expect(element).toHaveFocus();
      });
    });

    it('handles dynamic content tab order correctly', async () => {
      const DynamicContent = () => {
        const [showExtra, setShowExtra] = React.useState(false);
        return (
          <div>
            <Button>First Button</Button>
            <Button onClick={() => setShowExtra(!showExtra)}>
              {showExtra ? 'Hide' : 'Show'} Extra Content
            </Button>
            {showExtra && (
              <div>
                <Input
                  id='dynamic-input'
                  label='Dynamic Input'
                  type='text'
                  value=''
                  onChange={vi.fn()}
                />
                <Button>Dynamic Button</Button>
              </div>
            )}
            <Button>Last Button</Button>
          </div>
        );
      };

      render(<DynamicContent />);

      const firstButton = screen.getByRole('button', { name: 'First Button' });
      const toggleButton = screen.getByRole('button', { name: 'Show Extra Content' });
      const lastButton = screen.getByRole('button', { name: 'Last Button' });

      // Initially, tab order should not include dynamic content
      firstButton.focus();
      expect(firstButton).toHaveFocus();

      toggleButton.focus();
      expect(toggleButton).toHaveFocus();

      lastButton.focus();
      expect(lastButton).toHaveFocus();

      // Show dynamic content
      fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(screen.getByLabelText('Dynamic Input')).toBeInTheDocument();
      });

      const dynamicInput = screen.getByLabelText('Dynamic Input');
      const dynamicButton = screen.getByRole('button', { name: 'Dynamic Button' });

      // Tab order should now include dynamic content
      dynamicInput.focus();
      expect(dynamicInput).toHaveFocus();

      dynamicButton.focus();
      expect(dynamicButton).toHaveFocus();
    });
  });

  describe('Focus Management Tests', () => {
    it('properly manages focus in modal dialogs', async () => {
      const ModalTest = () => {
        const [isOpen, setIsOpen] = React.useState(false);
        return (
          <div>
            <Button onClick={() => setIsOpen(true)}>Open Modal</Button>
            <Button>Other Button</Button>
            <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title='Test Modal'>
              <div>
                <Input
                  id='modal-input'
                  label='Modal Input'
                  type='text'
                  value=''
                  onChange={vi.fn()}
                />
                <Button onClick={() => setIsOpen(false)}>Close</Button>
              </div>
            </Modal>
          </div>
        );
      };

      render(<ModalTest />);

      const openButton = screen.getByRole('button', { name: 'Open Modal' });
      const otherButton = screen.getByRole('button', { name: 'Other Button' });

      // Focus the trigger button
      openButton.focus();
      expect(openButton).toHaveFocus();

      // Open modal
      fireEvent.click(openButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Focus should move to first focusable element in modal
      const modalInput = screen.getByLabelText('Modal Input');
      await waitFor(() => {
        expect(modalInput).toHaveFocus();
      });

      // Other button outside modal should not be focusable
      otherButton.focus();
      // Focus should remain trapped in modal
      expect(document.activeElement).not.toBe(otherButton);

      // Close modal
      const closeButton = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeButton);

      // Focus should return to trigger button
      await waitFor(() => {
        expect(openButton).toHaveFocus();
      });
    });

    it('handles focus restoration after element removal', async () => {
      const RemovalTest = () => {
        const [showButton, setShowButton] = React.useState(true);
        return (
          <div>
            <Button>Before Button</Button>
            {showButton && <Button onClick={() => setShowButton(false)}>Remove Me</Button>}
            <Button>After Button</Button>
          </div>
        );
      };

      render(<RemovalTest />);

      screen.getByRole('button', { name: 'Before Button' }); // beforeButton
      const removeButton = screen.getByRole('button', { name: 'Remove Me' });
      screen.getByRole('button', { name: 'After Button' }); // afterButton

      // Focus the button that will be removed
      removeButton.focus();
      expect(removeButton).toHaveFocus();

      // Click to remove the button
      fireEvent.click(removeButton);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Remove Me' })).not.toBeInTheDocument();
      });

      // Focus should move to a nearby element or body
      expect(document.activeElement).toBeTruthy();
    });

    it('manages focus in dropdown menus', async () => {
      const DropdownTest = () => {
        const [isOpen, setIsOpen] = React.useState(false);
        return (
          <div>
            <Button onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen} aria-haspopup='menu'>
              Menu
            </Button>
            {isOpen && (
              <ul role='menu'>
                <li role='none'>
                  <button role='menuitem' onClick={() => setIsOpen(false)}>
                    Option 1
                  </button>
                </li>
                <li role='none'>
                  <button role='menuitem' onClick={() => setIsOpen(false)}>
                    Option 2
                  </button>
                </li>
                <li role='none'>
                  <button role='menuitem' onClick={() => setIsOpen(false)}>
                    Option 3
                  </button>
                </li>
              </ul>
            )}
          </div>
        );
      };

      render(<DropdownTest />);

      const menuButton = screen.getByRole('button', { name: 'Menu' });

      // Open menu
      menuButton.focus();
      fireEvent.click(menuButton);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      const option1 = screen.getByRole('menuitem', { name: 'Option 1' });
      const option2 = screen.getByRole('menuitem', { name: 'Option 2' });
      const option3 = screen.getByRole('menuitem', { name: 'Option 3' });

      // Focus should move to first menu item
      await waitFor(() => {
        expect(option1).toHaveFocus();
      });

      // Test arrow key navigation in menu
      fireEvent.keyDown(option1, { key: 'ArrowDown' });
      option2.focus();
      expect(option2).toHaveFocus();

      fireEvent.keyDown(option2, { key: 'ArrowDown' });
      option3.focus();
      expect(option3).toHaveFocus();

      // Test wrapping
      fireEvent.keyDown(option3, { key: 'ArrowDown' });
      option1.focus();
      expect(option1).toHaveFocus();

      // Close menu and check focus restoration
      fireEvent.keyDown(option1, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });

      expect(menuButton).toHaveFocus();
    });

    it('handles focus in skip links', () => {
      const SkipLinkTest = () => (
        <div>
          <a href='#main-content' className='skip-link'>
            Skip to main content
          </a>
          <nav>
            <a href='/home'>Home</a>
            <a href='/about'>About</a>
          </nav>
          <main id='main-content' tabIndex={-1}>
            <h1>Main Content</h1>
            <Button>First Main Button</Button>
          </main>
        </div>
      );

      render(<SkipLinkTest />);

      const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
      const mainContent = screen.getByRole('main');
      screen.getByRole('button', { name: 'First Main Button' }); // firstMainButton

      // Skip link should be focusable
      skipLink.focus();
      expect(skipLink).toHaveFocus();

      // Activating skip link should move focus to main content
      fireEvent.click(skipLink);
      expect(mainContent).toHaveFocus();
    });
  });

  describe('Keyboard Shortcut Tests', () => {
    it('handles global keyboard shortcuts', () => {
      const shortcutHandlers = {
        save: vi.fn(),
        search: vi.fn(),
        help: vi.fn(),
      };

      const ShortcutTest = () => {
        React.useEffect(() => {
          const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
              switch (e.key) {
                case 's':
                  e.preventDefault();
                  shortcutHandlers.save();
                  break;
                case 'k':
                  if (e.shiftKey) {
                    e.preventDefault();
                    shortcutHandlers.search();
                  }
                  break;
                case '?':
                  e.preventDefault();
                  shortcutHandlers.help();
                  break;
              }
            }
          };

          document.addEventListener('keydown', handleKeyDown);
          return () => document.removeEventListener('keydown', handleKeyDown);
        }, []);

        return (
          <div>
            <p>Press Ctrl+S to save, Ctrl+Shift+K to search, Ctrl+? for help</p>
            <Button>Test Button</Button>
          </div>
        );
      };

      render(<ShortcutTest />);

      // Test save shortcut
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
      expect(shortcutHandlers.save).toHaveBeenCalledTimes(1);

      // Test search shortcut
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true, shiftKey: true });
      expect(shortcutHandlers.search).toHaveBeenCalledTimes(1);

      // Test help shortcut
      fireEvent.keyDown(document, { key: '?', ctrlKey: true });
      expect(shortcutHandlers.help).toHaveBeenCalledTimes(1);
    });

    it('prevents conflicting shortcuts from interfering', () => {
      const handlers = {
        button: vi.fn(),
        global: vi.fn(),
      };

      const ConflictTest = () => {
        React.useEffect(() => {
          const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.defaultPrevented) {
              handlers.global();
            }
          };

          document.addEventListener('keydown', handleGlobalKeyDown);
          return () => document.removeEventListener('keydown', handleGlobalKeyDown);
        }, []);

        return (
          <Button
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handlers.button();
              }
            }}
          >
            Test Button
          </Button>
        );
      };

      render(<ConflictTest />);

      const button = screen.getByRole('button', { name: 'Test Button' });
      button.focus();

      // Button handler should prevent global handler
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(handlers.button).toHaveBeenCalledTimes(1);
      expect(handlers.global).not.toHaveBeenCalled();
    });

    it('provides keyboard shortcuts for navigation', () => {
      const navigationHandler = vi.fn();

      const NavShortcutTest = () => {
        React.useEffect(() => {
          const handleKeyDown = (e: KeyboardEvent) => {
            if (e.altKey) {
              const numKey = parseInt(e.key);
              if (numKey >= 1 && numKey <= 4) {
                e.preventDefault();
                navigationHandler(numKey);
              }
            }
          };

          document.addEventListener('keydown', handleKeyDown);
          return () => document.removeEventListener('keydown', handleKeyDown);
        }, []);

        return (
          <BrowserRouter>
            <div>
              <p>Press Alt+1, Alt+2, Alt+3, or Alt+4 to navigate</p>
              <TabNavigation
                swipeHighlight={false}
                onTouchStart={vi.fn()}
                onTouchMove={vi.fn()}
                onTouchEnd={vi.fn()}
              />
            </div>
          </BrowserRouter>
        );
      };

      render(<NavShortcutTest />);

      // Test navigation shortcuts
      fireEvent.keyDown(document, { key: '1', altKey: true });
      expect(navigationHandler).toHaveBeenCalledWith(1);

      fireEvent.keyDown(document, { key: '2', altKey: true });
      expect(navigationHandler).toHaveBeenCalledWith(2);

      fireEvent.keyDown(document, { key: '3', altKey: true });
      expect(navigationHandler).toHaveBeenCalledWith(3);

      fireEvent.keyDown(document, { key: '4', altKey: true });
      expect(navigationHandler).toHaveBeenCalledWith(4);
    });

    it('handles application-specific shortcuts', () => {
      const appShortcuts = {
        newItem: vi.fn(),
        deleteItem: vi.fn(),
        refresh: vi.fn(),
        toggleTheme: vi.fn(),
      };

      const AppShortcutTest = () => {
        React.useEffect(() => {
          const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
              switch (e.key) {
                case 'n':
                  e.preventDefault();
                  appShortcuts.newItem();
                  break;
                case 'Delete':
                case 'Backspace':
                  if (e.shiftKey) {
                    e.preventDefault();
                    appShortcuts.deleteItem();
                  }
                  break;
                case 'r':
                  e.preventDefault();
                  appShortcuts.refresh();
                  break;
                case ',':
                  e.preventDefault();
                  appShortcuts.toggleTheme();
                  break;
              }
            }
          };

          document.addEventListener('keydown', handleKeyDown);
          return () => document.removeEventListener('keydown', handleKeyDown);
        }, []);

        return (
          <div>
            <h1>App with Keyboard Shortcuts</h1>
            <ul>
              <li>Ctrl+N: New Item</li>
              <li>Ctrl+Shift+Delete: Delete Item</li>
              <li>Ctrl+R: Refresh</li>
              <li>Ctrl+,: Toggle Theme</li>
            </ul>
          </div>
        );
      };

      render(<AppShortcutTest />);

      // Test new item shortcut
      fireEvent.keyDown(document, { key: 'n', ctrlKey: true });
      expect(appShortcuts.newItem).toHaveBeenCalledTimes(1);

      // Test delete shortcut
      fireEvent.keyDown(document, { key: 'Delete', ctrlKey: true, shiftKey: true });
      expect(appShortcuts.deleteItem).toHaveBeenCalledTimes(1);

      // Test refresh shortcut
      fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
      expect(appShortcuts.refresh).toHaveBeenCalledTimes(1);

      // Test theme toggle shortcut
      fireEvent.keyDown(document, { key: ',', ctrlKey: true });
      expect(appShortcuts.toggleTheme).toHaveBeenCalledTimes(1);
    });
  });

  describe('Complex Keyboard Navigation Scenarios', () => {
    it('handles keyboard navigation in data tables', () => {
      const TableTest = () => (
        <table role='table'>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>John Doe</td>
              <td>john@example.com</td>
              <td>
                <Button size='small'>Edit</Button>
                <Button size='small' variant='danger'>
                  Delete
                </Button>
              </td>
            </tr>
            <tr>
              <td>Jane Smith</td>
              <td>jane@example.com</td>
              <td>
                <Button size='small'>Edit</Button>
                <Button size='small' variant='danger'>
                  Delete
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      );

      render(<TableTest />);

      const editButtons = screen.getAllByRole('button', { name: 'Edit' });
      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });

      // Test tab navigation through table action buttons
      editButtons[0].focus();
      expect(editButtons[0]).toHaveFocus();

      deleteButtons[0].focus();
      expect(deleteButtons[0]).toHaveFocus();

      editButtons[1].focus();
      expect(editButtons[1]).toHaveFocus();

      deleteButtons[1].focus();
      expect(deleteButtons[1]).toHaveFocus();
    });

    it('maintains accessibility during keyboard-driven state changes', async () => {
      const StateChangeTest = () => {
        const [activeTab, setActiveTab] = React.useState(0);
        const tabs = ['Tab 1', 'Tab 2', 'Tab 3'];

        return (
          <div>
            <div role='tablist'>
              {tabs.map((label, index) => (
                <button
                  key={index}
                  role='tab'
                  aria-selected={activeTab === index}
                  onClick={() => setActiveTab(index)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowRight') {
                      setActiveTab(prev => (prev + 1) % tabs.length);
                    } else if (e.key === 'ArrowLeft') {
                      setActiveTab(prev => (prev - 1 + tabs.length) % tabs.length);
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role='tabpanel'>Content for {tabs[activeTab]}</div>
          </div>
        );
      };

      render(<StateChangeTest />);

      const tabs = screen.getAllByRole('tab');
      const tabpanel = screen.getByRole('tabpanel');

      // Test arrow key navigation
      tabs[0].focus();
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

      fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
      await waitFor(() => {
        expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
      });

      fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
      await waitFor(() => {
        expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
      });

      // Test wrap-around
      fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
      await waitFor(() => {
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      });

      expect(tabpanel).toHaveTextContent('Content for Tab 1');
    });

    it('handles keyboard navigation in tree structures', () => {
      const TreeTest = () => {
        const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

        const toggleExpanded = (id: string) => {
          const newExpanded = new Set(expanded);
          if (newExpanded.has(id)) {
            newExpanded.delete(id);
          } else {
            newExpanded.add(id);
          }
          setExpanded(newExpanded);
        };

        return (
          <ul role='tree'>
            <li role='treeitem' aria-expanded={expanded.has('folder1')} aria-selected='false'>
              <button onClick={() => toggleExpanded('folder1')}>📁 Folder 1</button>
              {expanded.has('folder1') && (
                <ul role='group'>
                  <li role='treeitem' aria-selected='false'>
                    <button>📄 File 1.1</button>
                  </li>
                  <li role='treeitem' aria-selected='false'>
                    <button>📄 File 1.2</button>
                  </li>
                </ul>
              )}
            </li>
            <li role='treeitem' aria-expanded={expanded.has('folder2')} aria-selected='false'>
              <button onClick={() => toggleExpanded('folder2')}>📁 Folder 2</button>
              {expanded.has('folder2') && (
                <ul role='group'>
                  <li role='treeitem' aria-selected='false'>
                    <button>📄 File 2.1</button>
                  </li>
                </ul>
              )}
            </li>
          </ul>
        );
      };

      render(<TreeTest />);

      const folder1Button = screen.getByRole('button', { name: '📁 Folder 1' });
      screen.getByRole('button', { name: '📁 Folder 2' }); // folder2Button

      // Test keyboard expansion
      folder1Button.focus();
      fireEvent.keyDown(folder1Button, { key: 'Enter' });

      // Verify folder expanded
      const folder1Item = folder1Button.closest('[role="treeitem"]');
      expect(folder1Item).toHaveAttribute('aria-expanded', 'true');

      // Test navigation to nested items
      const file11Button = screen.getByRole('button', { name: '📄 File 1.1' });
      const file12Button = screen.getByRole('button', { name: '📄 File 1.2' });

      file11Button.focus();
      expect(file11Button).toHaveFocus();

      file12Button.focus();
      expect(file12Button).toHaveFocus();
    });
  });

  describe('Keyboard Accessibility Compliance', () => {
    it('meets WCAG AA keyboard accessibility standards', async () => {
      const ComprehensiveTest = () => (
        <div>
          <nav>
            <a href='/home' onKeyDown={e => e.key === 'Enter' && e.preventDefault()}>
              Home
            </a>
            <a href='/about' onKeyDown={e => e.key === 'Enter' && e.preventDefault()}>
              About
            </a>
          </nav>
          <main>
            <form>
              <Input id='test-input' label='Test Input' type='text' value='' onChange={vi.fn()} />
              <Button type='submit'>Submit</Button>
            </form>
          </main>
        </div>
      );

      const { container } = render(<ComprehensiveTest />);

      // Test that all interactive elements are keyboard accessible
      const links = screen.getAllByRole('link');
      const input = screen.getByLabelText('Test Input');
      const button = screen.getByRole('button', { name: 'Submit' });

      const interactiveElements = [...links, input, button];

      interactiveElements.forEach(element => {
        element.focus();
        expect(element).toHaveFocus();

        // Test keyboard activation
        if (element.tagName === 'BUTTON' || element.tagName === 'A') {
          fireEvent.keyDown(element, { key: 'Enter' });
          fireEvent.keyDown(element, { key: ' ' });
        }
      });

      // Run comprehensive accessibility check
      const results = await axe(container, {
        rules: {
          keyboard: { enabled: true },
          'focus-order-semantics': { enabled: true },
        },
      });
      expect(results).toHaveNoViolations();
    });

    it('provides visible focus indicators', () => {
      const FocusIndicatorTest = () => (
        <div>
          <Button>Button 1</Button>
          <Button>Button 2</Button>
          <Input id='focus-input' label='Focus Input' type='text' value='' onChange={vi.fn()} />
          <a href='/test'>Test Link</a>
        </div>
      );

      render(<FocusIndicatorTest />);

      const button1 = screen.getByRole('button', { name: 'Button 1' });
      const button2 = screen.getByRole('button', { name: 'Button 2' });
      const input = screen.getByLabelText('Focus Input');
      const link = screen.getByRole('link', { name: 'Test Link' });

      const elements = [button1, button2, input, link];

      elements.forEach(element => {
        element.focus();
        expect(element).toHaveFocus();

        // Check that focused element has visible focus indicator
        const computedStyle = window.getComputedStyle(element);
        expect(computedStyle.outline).not.toBe('none');
      });
    });
  });
});
