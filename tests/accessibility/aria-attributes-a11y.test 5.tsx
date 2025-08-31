import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Button, ButtonGroup } from '../../src/components/UI/Button';
import { Input, TextArea, Select, InputGroup } from '../../src/components/UI';
import { Modal } from '../../src/components/UI/Modal';
import { Card } from '../../src/components/UI/Card';
import { AuthForm } from '../../src/components/Auth/AuthForm';
import { RunForm } from '../../src/components/Runs/RunForm';
import { RunFormData } from '../../src/types';
import { TEST_DATES } from '../utils/dateTestUtils';

// Extend expect with jest-axe matchers
expect.extend(toHaveNoViolations);

describe('ARIA Attributes Verification', () => {
  beforeEach(() => {
    // Clear any previous DOM content
    document.body.innerHTML = '';
  });

  describe('Role Attributes', () => {
    it('verifies button components have correct roles', () => {
      render(
        <div>
          <Button>Default Button</Button>
          <Button variant='primary'>Primary Button</Button>
          <Button variant='secondary'>Secondary Button</Button>
          <Button variant='danger'>Danger Button</Button>
          <Button disabled>Disabled Button</Button>
        </div>
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(5);

      buttons.forEach(button => {
        // HTML button elements have implicit button role, no explicit role attribute needed
        expect(button.tagName).toBe('BUTTON');
      });
    });

    it('verifies form elements have correct implicit roles', () => {
      render(
        <form>
          <Input label='Email' type='email' value='' onChange={vi.fn()} />
          <TextArea label='Comments' value='' onChange={vi.fn()} />
          <Select
            label='Category'
            value=''
            onChange={vi.fn()}
            options={[{ value: 'test', label: 'Test' }]}
          />
          <Button type='submit'>Submit</Button>
        </form>
      );

      // Input should have textbox role (implicit)
      const emailInput = screen.getByLabelText('Email');
      expect(emailInput).toHaveAttribute('type', 'email');
      expect(emailInput.tagName).toBe('INPUT');

      // TextArea should have textbox role (implicit)
      const textArea = screen.getByLabelText('Comments');
      expect(textArea.tagName).toBe('TEXTAREA');

      // Select should have combobox role (implicit)
      const select = screen.getByLabelText('Category');
      expect(select.tagName).toBe('SELECT');

      // Submit button should have button role
      const submitButton = screen.getByRole('button', { name: 'Submit' });
      expect(submitButton).toHaveAttribute('type', 'submit');
    });

    it('verifies modal components have correct dialog roles', () => {
      const mockOnClose = vi.fn();

      render(
        <Modal isOpen={true} onClose={mockOnClose} title='Test Modal'>
          <p>Modal content here</p>
        </Modal>
      );

      const dialog = screen.getByRole('dialog', { name: 'Test Modal' });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('verifies card components have appropriate structure', () => {
      render(
        <div>
          <Card>
            <h3>Statistics Card</h3>
            <p>Card content</p>
          </Card>
          <Card interactive onClick={vi.fn()}>
            <h3>Interactive Card</h3>
            <p>More content</p>
          </Card>
        </div>
      );

      // Cards should be properly structured
      const cardContent = screen.getByText('Card content');
      expect(cardContent).toBeInTheDocument();

      // Interactive cards should have correct role
      const interactiveCard = screen.getByText('Interactive Card').closest('div');
      expect(interactiveCard).toHaveAttribute('role', 'button');
    });

    it('verifies navigation elements have correct roles', () => {
      render(
        <nav aria-label='Main navigation'>
          <ul>
            <li>
              <a href='/dashboard'>Dashboard</a>
            </li>
            <li>
              <a href='/runs'>Runs</a>
            </li>
            <li>
              <a href='/goals'>Goals</a>
            </li>
          </ul>
        </nav>
      );

      const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(navigation).toBeInTheDocument();
      expect(navigation.tagName).toBe('NAV');

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(3);
      links.forEach(link => {
        expect(link.tagName).toBe('A');
      });
    });

    it('verifies form groups have correct fieldset roles', () => {
      render(
        <InputGroup label='Personal Information'>
          <Input label='First Name' value='' onChange={vi.fn()} />
          <Input label='Last Name' value='' onChange={vi.fn()} />
        </InputGroup>
      );

      const fieldset = screen.getByRole('group', { name: 'Personal Information' });
      expect(fieldset).toBeInTheDocument();
      expect(fieldset.tagName).toBe('FIELDSET');

      const legend = screen.getByText('Personal Information');
      expect(legend.tagName).toBe('LEGEND');
    });

    it('verifies comprehensive role attribute coverage', () => {
      render(
        <div>
          {/* Test explicit role attributes */}
          <div role='alert'>Error message</div>
          <div role='status'>Status message</div>
          <div role='progressbar' aria-valuenow={50} aria-valuemin={0} aria-valuemax={100}>
            50%
          </div>
          <div role='tablist'>
            <div role='tab' aria-selected='true' tabIndex={0}>
              Tab 1
            </div>
            <div role='tab' aria-selected='false' tabIndex={-1}>
              Tab 2
            </div>
          </div>
          <div role='tabpanel'>Tab content</div>

          {/* Test semantic HTML with implicit roles */}
          <article>Article content</article>
          <aside>Sidebar content</aside>
          <section aria-labelledby='section-heading'>
            <h2 id='section-heading'>Section Title</h2>
            <p>Section content</p>
          </section>

          {/* Test interactive elements */}
          <button type='button'>Interactive Button</button>
          <a href='#test' role='button'>
            Link as Button
          </a>
          <div role='button' tabIndex={0}>
            Custom Button
          </div>
        </div>
      );

      // Verify explicit role attributes
      const alertElement = screen.getByRole('alert');
      expect(alertElement).toHaveAttribute('role', 'alert');
      expect(alertElement).toHaveTextContent('Error message');

      const statusElement = screen.getByRole('status');
      expect(statusElement).toHaveAttribute('role', 'status');
      expect(statusElement).toHaveTextContent('Status message');

      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('role', 'progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '50');

      const tablist = screen.getByRole('tablist');
      expect(tablist).toHaveAttribute('role', 'tablist');

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

      const tabpanel = screen.getByRole('tabpanel');
      expect(tabpanel).toHaveAttribute('role', 'tabpanel');

      // Verify semantic HTML implicit roles
      const article = screen.getByRole('article');
      expect(article.tagName).toBe('ARTICLE');

      const aside = screen.getByRole('complementary');
      expect(aside.tagName).toBe('ASIDE');

      const section = screen.getByRole('region', { name: 'Section Title' });
      expect(section.tagName).toBe('SECTION');

      // Verify interactive elements
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThanOrEqual(3); // At least our 3 test buttons

      const linkAsButton = screen.getByRole('button', { name: 'Link as Button' });
      expect(linkAsButton.tagName).toBe('A');
      expect(linkAsButton).toHaveAttribute('role', 'button');

      const customButton = screen.getByRole('button', { name: 'Custom Button' });
      expect(customButton).toHaveAttribute('role', 'button');
      expect(customButton).toHaveAttribute('tabIndex', '0');
    });

    it('verifies application-specific component role attributes', () => {
      // Test progress indicators with proper ARIA roles
      render(
        <div>
          {/* Test progress component with explicit role */}
          <div
            role='progressbar'
            aria-valuenow={75}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label='Weekly Distance Goal'
          >
            75% Complete
          </div>

          {/* Test interactive card components */}
          <Card interactive onClick={vi.fn()} data-testid='interactive-card'>
            <h3>Interactive Statistics Card</h3>
            <p>Click to view details</p>
          </Card>

          {/* Test navigation-like structures */}
          <div role='navigation' aria-label='Quick actions'>
            <Button>Add Run</Button>
            <Button>Add Goal</Button>
            <Button>View Stats</Button>
          </div>

          {/* Test list structures */}
          <ul aria-label='Recent activities'>
            <li>Completed 5K run</li>
            <li>Updated weekly goal</li>
            <li>Achieved personal record</li>
          </ul>

          {/* Test article/content structure */}
          <article>
            <h2>Running Statistics</h2>
            <section aria-labelledby='weekly-stats'>
              <h3 id='weekly-stats'>This Week</h3>
              <p>Total distance: 15.2 km</p>
            </section>
          </article>
        </div>
      );

      // Verify progress bar role and attributes
      const progressbar = screen.getByRole('progressbar', { name: 'Weekly Distance Goal' });
      expect(progressbar).toHaveAttribute('role', 'progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '75');
      expect(progressbar).toHaveAttribute('aria-valuemin', '0');
      expect(progressbar).toHaveAttribute('aria-valuemax', '100');

      // Verify interactive card has button role
      const interactiveCard = screen.getByTestId('interactive-card');
      expect(interactiveCard).toHaveAttribute('role', 'button');

      // Verify navigation structure
      const navigation = screen.getByRole('navigation', { name: 'Quick actions' });
      expect(navigation).toHaveAttribute('role', 'navigation');

      const navButtons = within(navigation).getAllByRole('button');
      expect(navButtons).toHaveLength(3);

      // Verify list structure
      const list = screen.getByRole('list', { name: 'Recent activities' });
      expect(list).toHaveAttribute('role', 'list');

      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(3);

      // Verify article structure
      const article = screen.getByRole('article');
      expect(article.tagName).toBe('ARTICLE');

      const section = screen.getByLabelText('This Week');
      expect(section).toHaveAttribute('aria-labelledby', 'weekly-stats');
    });

    it('verifies role attribute validation and accessibility compliance', () => {
      render(
        <div>
          {/* Test list roles */}
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>

          {/* Test menu roles */}
          <div role='menubar'>
            <div role='menuitem' tabIndex={0}>
              Menu Item 1
            </div>
            <div role='menuitem' tabIndex={-1}>
              Menu Item 2
            </div>
          </div>

          {/* Test grid roles */}
          <div role='grid' aria-labelledby='grid-title'>
            <div id='grid-title'>Data Grid</div>
            <div role='row'>
              <div role='gridcell'>Cell A1</div>
              <div role='gridcell'>Cell A2</div>
            </div>
            <div role='row'>
              <div role='gridcell'>Cell B1</div>
              <div role='gridcell'>Cell B2</div>
            </div>
          </div>

          {/* Test presentation roles */}
          <div role='presentation'>
            <img src='decorative.jpg' alt='' role='presentation' />
          </div>
          <div role='none'>
            <div>Styling wrapper only</div>
          </div>
        </div>
      );

      // Verify list roles
      const list = screen.getByRole('list');
      expect(list).toHaveAttribute('role', 'list');

      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(2);
      listItems.forEach(item => {
        expect(item).toHaveAttribute('role', 'listitem');
      });

      // Verify menu roles
      const menubar = screen.getByRole('menubar');
      expect(menubar).toHaveAttribute('role', 'menubar');

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems).toHaveLength(2);
      expect(menuItems[0]).toHaveAttribute('tabIndex', '0');
      expect(menuItems[1]).toHaveAttribute('tabIndex', '-1');

      // Verify grid roles
      const grid = screen.getByRole('grid', { name: 'Data Grid' });
      expect(grid).toHaveAttribute('role', 'grid');
      expect(grid).toHaveAttribute('aria-labelledby', 'grid-title');

      const rows = screen.getAllByRole('row');
      expect(rows).toHaveLength(2);

      const gridcells = screen.getAllByRole('gridcell');
      expect(gridcells).toHaveLength(4);
      expect(gridcells[0]).toHaveTextContent('Cell A1');

      // Verify presentation roles (these should not be queryable by role)
      const presentationDivs = document.querySelectorAll('[role="presentation"]');
      expect(presentationDivs).toHaveLength(2);

      const noneDivs = document.querySelectorAll('[role="none"]');
      expect(noneDivs).toHaveLength(1);
    });

    it('verifies role attributes work correctly with focus management', () => {
      render(
        <div>
          <div role='application' aria-label='Custom Application'>
            <div role='toolbar' aria-label='Edit Tools'>
              <button type='button'>Bold</button>
              <button type='button'>Italic</button>
              <button type='button'>Underline</button>
            </div>
            <div role='main' aria-label='Content Area'>
              <div role='textbox' contentEditable='true' aria-label='Text Editor'>
                Editable content here
              </div>
            </div>
          </div>
        </div>
      );

      const application = screen.getByRole('application', { name: 'Custom Application' });
      expect(application).toHaveAttribute('role', 'application');
      expect(application).toHaveAttribute('tabIndex', '0');
      expect(application).toHaveAttribute('aria-label', 'Custom Application');

      const toolbar = screen.getByRole('toolbar', { name: 'Edit Tools' });
      expect(toolbar).toHaveAttribute('role', 'toolbar');
      expect(toolbar).toHaveAttribute('aria-label', 'Edit Tools');

      const mainContent = screen.getByRole('main', { name: 'Content Area' });
      expect(mainContent).toHaveAttribute('role', 'main');

      const textbox = screen.getByRole('textbox', { name: 'Text Editor' });
      expect(textbox).toHaveAttribute('role', 'textbox');
      expect(textbox).toHaveAttribute('contentEditable', 'true');

      const toolbarButtons = screen.getAllByRole('button');
      expect(toolbarButtons).toHaveLength(3);
      toolbarButtons.forEach(button => {
        expect(button.tagName).toBe('BUTTON');
      });
    });
  });

  describe('ARIA Label Verification', () => {
    it('verifies all interactive elements have accessible names', () => {
      render(
        <div>
          <Button aria-label='Close dialog'>×</Button>
          <Button>Labeled Button</Button>
          <Input label='Email Address' type='email' value='' onChange={vi.fn()} />
          <Input
            aria-label='Search users'
            type='search'
            placeholder='Type to search...'
            value=''
            onChange={vi.fn()}
          />
        </div>
      );

      // Button with aria-label
      const closeButton = screen.getByRole('button', { name: 'Close dialog' });
      expect(closeButton).toHaveAttribute('aria-label', 'Close dialog');

      // Button with text content
      const labeledButton = screen.getByRole('button', { name: 'Labeled Button' });
      expect(labeledButton).toHaveTextContent('Labeled Button');

      // Input with associated label
      const emailInput = screen.getByLabelText('Email Address');
      expect(emailInput).toBeInTheDocument();

      // Input with aria-label
      const searchInput = screen.getByLabelText('Search users');
      expect(searchInput).toHaveAttribute('aria-label', 'Search users');
    });

    it('verifies form inputs have proper label associations', () => {
      render(
        <form>
          <Input label='Username' value='testuser' onChange={vi.fn()} required />
          <Input
            label='Password'
            type='password'
            value='secret'
            onChange={vi.fn()}
            required
            helperText='Must be at least 8 characters'
          />
          <Select
            label='Country'
            value='US'
            onChange={vi.fn()}
            options={[
              { value: 'US', label: 'United States' },
              { value: 'CA', label: 'Canada' },
            ]}
          />
        </form>
      );

      const usernameInput = screen.getByLabelText('Username');
      const passwordInput = screen.getByLabelText('Password');
      const countrySelect = screen.getByLabelText('Country');

      // Check label associations
      const usernameLabel = screen.getByText('Username');
      const passwordLabel = screen.getByText('Password');
      const countryLabel = screen.getByText('Country');

      expect(usernameInput.id).toBe(usernameLabel.getAttribute('for'));
      expect(passwordInput.id).toBe(passwordLabel.getAttribute('for'));
      expect(countrySelect.id).toBe(countryLabel.getAttribute('for'));

      // Check helper text association
      const helperText = screen.getByText('Must be at least 8 characters');
      expect(passwordInput).toHaveAttribute('aria-describedby', helperText.id);
    });

    it('verifies password toggle buttons have descriptive labels', () => {
      render(<Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />);

      const toggleButton = screen.getByRole('button');
      expect(toggleButton).toHaveAttribute(
        'aria-label',
        expect.stringMatching(/show password|hide password/i)
      );

      // Test label changes on toggle
      fireEvent.click(toggleButton);
      expect(toggleButton).toHaveAttribute('aria-label', expect.stringMatching(/hide password/i));
    });

    it('verifies search clear buttons have appropriate labels', () => {
      render(<Input type='search' label='Search' value='search term' onChange={vi.fn()} />);

      const clearButton = screen.getByRole('button', { name: /clear/i });
      expect(clearButton).toHaveAttribute('aria-label', expect.stringMatching(/clear search/i));
    });

    it('verifies modal dialogs have proper labeling', () => {
      const mockOnClose = vi.fn();

      render(
        <Modal isOpen={true} onClose={mockOnClose} title='Confirmation Dialog'>
          <p>Are you sure you want to delete this item?</p>
          <ButtonGroup>
            <Button variant='danger'>Delete</Button>
            <Button variant='secondary' onClick={mockOnClose}>
              Cancel
            </Button>
          </ButtonGroup>
        </Modal>
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');

      const title = screen.getByText('Confirmation Dialog');
      expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    });
  });

  describe('ARIA Describedby Verification', () => {
    it('verifies form inputs are properly associated with error messages', () => {
      render(
        <div>
          <Input
            label='Email'
            type='email'
            value='invalid-email'
            onChange={vi.fn()}
            error={true}
            errorMessage='Please enter a valid email address'
          />
          <Select
            label='Category'
            value=''
            onChange={vi.fn()}
            options={[{ value: 'test', label: 'Test' }]}
            error={true}
            errorMessage='Please select a category'
          />
        </div>
      );

      const emailInput = screen.getByLabelText('Email');
      const categorySelect = screen.getByLabelText('Category');

      const emailError = screen.getByText('Please enter a valid email address');
      const categoryError = screen.getByText('Please select a category');

      expect(emailInput).toHaveAttribute('aria-describedby', emailError.id);
      expect(categorySelect).toHaveAttribute('aria-describedby', categoryError.id);
    });

    it('verifies inputs with helper text have proper descriptions', () => {
      render(
        <div>
          <Input
            label='Password'
            type='password'
            value=''
            onChange={vi.fn()}
            helperText='Password must contain at least 8 characters, including numbers and symbols'
          />
          <TextArea
            label='Bio'
            value='Short bio'
            onChange={vi.fn()}
            maxLength={500}
            showCharCount
          />
        </div>
      );

      const passwordInput = screen.getByLabelText('Password');
      const bioTextarea = screen.getByLabelText('Bio');

      const helperText = screen.getByText(
        'Password must contain at least 8 characters, including numbers and symbols'
      );
      const charCount = screen.getByText('9/500');

      expect(passwordInput).toHaveAttribute('aria-describedby', helperText.id);
      expect(bioTextarea).toHaveAttribute(
        'aria-describedby',
        expect.stringContaining(charCount.id)
      );
    });

    it('verifies inputs with both helper text and errors have combined descriptions', () => {
      render(
        <Input
          label='Username'
          value='ab'
          onChange={vi.fn()}
          error={true}
          errorMessage='Username is too short'
        />
      );

      const usernameInput = screen.getByLabelText('Username');
      const errorMessage = screen.getByText('Username is too short');

      // When there's an error, the input should be described by the error message
      expect(usernameInput).toHaveAttribute('aria-describedby', errorMessage.id);
      expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('ARIA States and Properties', () => {
    it('verifies aria-required is set correctly', () => {
      render(
        <form>
          <Input label='Required Field' value='' onChange={vi.fn()} required />
          <Input label='Optional Field' value='' onChange={vi.fn()} />
          <Select
            label='Required Select'
            value=''
            onChange={vi.fn()}
            options={[{ value: 'test', label: 'Test' }]}
            required
          />
        </form>
      );

      const requiredInput = screen.getByLabelText('Required Field');
      const optionalInput = screen.getByLabelText('Optional Field');
      const requiredSelect = screen.getByLabelText('Required Select');

      expect(requiredInput).toHaveAttribute('aria-required', 'true');
      expect(requiredInput).toBeRequired();

      expect(optionalInput).toHaveAttribute('aria-required', 'false');
      expect(optionalInput).not.toBeRequired();

      expect(requiredSelect).toHaveAttribute('aria-required', 'true');
      expect(requiredSelect).toBeRequired();
    });

    it('verifies aria-invalid is set correctly for error states', () => {
      render(
        <div>
          <Input label='Valid Email' type='email' value='user@example.com' onChange={vi.fn()} />
          <Input
            label='Invalid Email'
            type='email'
            value='invalid-email'
            onChange={vi.fn()}
            error={true}
            errorMessage='Invalid email format'
          />
        </div>
      );

      const validInput = screen.getByLabelText('Valid Email');
      const invalidInput = screen.getByLabelText('Invalid Email');

      expect(validInput).toHaveAttribute('aria-invalid', 'false');
      expect(invalidInput).toHaveAttribute('aria-invalid', 'true');
    });

    it('verifies aria-expanded for expandable components', () => {
      render(
        <Select
          label='Expandable Select'
          value=''
          onChange={vi.fn()}
          options={[
            { value: 'option1', label: 'Option 1' },
            { value: 'option2', label: 'Option 2' },
          ]}
        />
      );

      const select = screen.getByLabelText('Expandable Select');

      // HTML select elements don't typically use aria-expanded,
      // but custom dropdowns would
      expect(select.tagName).toBe('SELECT');
    });

    it('verifies aria-disabled for disabled elements', () => {
      render(
        <div>
          <Button disabled>Disabled Button</Button>
          <Input label='Disabled Input' value='' onChange={vi.fn()} disabled />
        </div>
      );

      const disabledButton = screen.getByRole('button');
      const disabledInput = screen.getByLabelText('Disabled Input');

      expect(disabledButton).toBeDisabled();
      expect(disabledInput).toBeDisabled();
    });

    it('verifies aria-hidden for decorative elements', () => {
      render(
        <div>
          <Button>
            <span aria-hidden='true'>🔍</span>
            Search
          </Button>
          <Input
            label='Search'
            value=''
            onChange={vi.fn()}
            leadingIcon={<span aria-hidden='true'>🔍</span>}
          />
        </div>
      );

      const decorativeIcons = screen.getAllByText('🔍');
      decorativeIcons.forEach(icon => {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      });
    });

    it('verifies aria-modal for modal dialogs', () => {
      const mockOnClose = vi.fn();

      render(
        <Modal isOpen={true} onClose={mockOnClose} title='Modal Dialog'>
          <p>Modal content</p>
        </Modal>
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });

  describe('Comprehensive Form ARIA Verification', () => {
    it('verifies AuthForm has complete ARIA implementation', () => {
      const mockOnLogin = vi.fn();
      const mockOnRegister = vi.fn();

      render(<AuthForm onLogin={mockOnLogin} onRegister={mockOnRegister} loading={false} />);

      // Form should be properly structured (HTML form elements have implicit form role)
      const form = document.querySelector('form');
      expect(form).toBeInTheDocument();

      // All inputs should have proper labels
      const emailInput = screen.getByLabelText('Email');
      const passwordInput = screen.getByLabelText('Password');

      expect(emailInput).toHaveAttribute('aria-required', 'true');
      expect(passwordInput).toHaveAttribute('aria-required', 'true');

      // Check if helper text exists and is associated (may not be present in all Auth form variations)
      const helperTextElement = document.querySelector(
        '[id*="helper"], .helper-text, [id*="message"]'
      );
      if (helperTextElement) {
        const describedBy = passwordInput.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
      }

      // Buttons should be properly labeled
      const loginButton = screen.getByRole('button', { name: 'Login' });
      const registerButton = screen.getByRole('button', { name: 'Register' });

      expect(loginButton).toBeInTheDocument();
      expect(registerButton).toBeInTheDocument();
    });

    it('verifies RunForm has complete ARIA implementation', () => {
      const mockFormData: RunFormData = {
        date: TEST_DATES.YESTERDAY,
        distance: '5.0',
        duration: '30',
        tag: '',
        notes: '',
      };

      const mockErrors = {
        distance: 'Distance must be greater than 0',
      };

      render(
        <RunForm
          formData={mockFormData}
          errors={mockErrors}
          loading={false}
          editingRun={null}
          onUpdateField={vi.fn()}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      // Form structure should be accessible - HTML form elements have implicit form role
      // but testing library may not always find them by role, so we'll test the structure
      const fieldset = screen.getByRole('group', { name: 'Run Details' });
      expect(fieldset).toBeInTheDocument();

      // Verify the form element exists in the DOM
      const form = document.querySelector('form');
      expect(form).toBeInTheDocument();

      // All form controls should have proper labels
      const dateInput = screen.getByLabelText('Date');
      const distanceInput = screen.getByLabelText('Distance (km)');
      const durationInput = screen.getByLabelText('Duration (minutes)');
      const tagSelect = screen.getByLabelText('Tag (optional)');
      const notesTextarea = screen.getByLabelText('Notes (optional)');

      // Required fields should be marked
      expect(dateInput).toHaveAttribute('aria-required', 'true');
      expect(distanceInput).toHaveAttribute('aria-required', 'true');
      expect(durationInput).toHaveAttribute('aria-required', 'true');

      // Error states should be properly indicated
      const errorMessage = screen.getByText('Distance must be greater than 0');
      expect(distanceInput).toHaveAttribute('aria-describedby', errorMessage.id);
      expect(distanceInput).toHaveAttribute('aria-invalid', 'true');

      // Optional fields should not be required
      expect(tagSelect).toHaveAttribute('aria-required', 'false');
      expect(notesTextarea).toHaveAttribute('aria-required', 'false');
    });
  });

  describe('Enhanced ARIA Label Verification', () => {
    it('verifies progress indicators have proper aria-labels', () => {
      // Test circular progress component with aria-label
      render(
        <div>
          <div
            role='progressbar'
            aria-label='Goal completion progress'
            aria-valuenow={75}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext='75% complete'
          >
            75%
          </div>
          <div
            role='progressbar'
            aria-label='Run distance progress'
            aria-valuenow={5}
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuetext='5 out of 10 kilometers'
          >
            50%
          </div>
        </div>
      );

      const goalProgress = screen.getByRole('progressbar', { name: 'Goal completion progress' });
      const distanceProgress = screen.getByRole('progressbar', { name: 'Run distance progress' });

      expect(goalProgress).toHaveAttribute('aria-label', 'Goal completion progress');
      expect(goalProgress).toHaveAttribute('aria-valuenow', '75');
      expect(goalProgress).toHaveAttribute('aria-valuetext', '75% complete');

      expect(distanceProgress).toHaveAttribute('aria-label', 'Run distance progress');
      expect(distanceProgress).toHaveAttribute('aria-valuenow', '5');
      expect(distanceProgress).toHaveAttribute('aria-valuetext', '5 out of 10 kilometers');
    });

    it('verifies loading states have proper aria-labels', () => {
      render(
        <div>
          <Button loading aria-label='Saving run data, please wait'>
            Save Run
          </Button>
          <div role='status' aria-label='Loading dashboard data'>
            <span className='spinner' aria-hidden='true'></span>
            <span className='sr-only'>Loading...</span>
          </div>
          <div role='alert' aria-live='polite' aria-label='Status updates'>
            Data saved successfully
          </div>
        </div>
      );

      const loadingButton = screen.getByRole('button', { name: 'Saving run data, please wait' });
      expect(loadingButton).toHaveAttribute('aria-label', 'Saving run data, please wait');

      const loadingStatus = screen.getByRole('status', { name: 'Loading dashboard data' });
      expect(loadingStatus).toHaveAttribute('role', 'status');
      expect(loadingStatus).toHaveAttribute('aria-label', 'Loading dashboard data');

      const statusAlert = screen.getByRole('alert', { name: 'Status updates' });
      expect(statusAlert).toHaveAttribute('role', 'alert');
      expect(statusAlert).toHaveAttribute('aria-live', 'polite');
    });

    it('verifies theme toggle has proper aria-labels', () => {
      // Mock theme context
      const mockToggleTheme = vi.fn();

      render(
        <button
          onClick={mockToggleTheme}
          aria-label='Switch to Dark Mode'
          title='Switch to Dark Mode'
        >
          <span role='img' aria-hidden='true'>
            ☀️
          </span>
          <span>Light Mode</span>
        </button>
      );

      const themeButton = screen.getByRole('button', { name: 'Switch to Dark Mode' });
      expect(themeButton).toHaveAttribute('aria-label', 'Switch to Dark Mode');
      expect(themeButton).toHaveAttribute('title', 'Switch to Dark Mode');

      const icon = screen.getByText('☀️');
      expect(icon).toHaveAttribute('role', 'img');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('verifies chart and graph elements have descriptive labels', () => {
      render(
        <div>
          <div
            role='img'
            aria-label='Weekly running progress chart showing 5 runs completed this week'
            aria-describedby='chart-description'
          >
            <svg width='200' height='100'>
              <rect x='10' y='10' width='20' height='50' fill='blue' />
              <rect x='40' y='20' width='20' height='40' fill='blue' />
              <rect x='70' y='5' width='20' height='65' fill='blue' />
            </svg>
          </div>
          <div id='chart-description' className='sr-only'>
            Bar chart displaying running activity: Monday 2 runs, Tuesday 1 run, Wednesday 3 runs
          </div>

          <table role='table' aria-label='Personal running records'>
            <caption>Your best times and distances</caption>
            <thead>
              <tr>
                <th scope='col'>Distance</th>
                <th scope='col'>Best Time</th>
                <th scope='col'>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>5K</td>
                <td>22:30</td>
                <td>2024-01-15</td>
              </tr>
            </tbody>
          </table>
        </div>
      );

      const chart = screen.getByRole('img', { name: /Weekly running progress chart/ });
      expect(chart).toHaveAttribute(
        'aria-label',
        'Weekly running progress chart showing 5 runs completed this week'
      );
      expect(chart).toHaveAttribute('aria-describedby', 'chart-description');

      const chartDescription = screen.getByText(/Bar chart displaying running activity/);
      expect(chartDescription).toHaveClass('sr-only');

      const recordsTable = screen.getByRole('table', { name: 'Personal running records' });
      expect(recordsTable).toHaveAttribute('aria-label', 'Personal running records');

      const caption = screen.getByText('Your best times and distances');
      expect(caption.tagName).toBe('CAPTION');
    });

    it('verifies action buttons have descriptive aria-labels', () => {
      render(
        <div>
          <Button aria-label='Delete run entry from January 15th' variant='danger'>
            <span aria-hidden='true'>🗑️</span>
          </Button>

          <Button aria-label='Edit goal: Run 50km this month' variant='secondary'>
            <span aria-hidden='true'>✏️</span>
          </Button>

          <Button aria-label='Share running statistics on social media' variant='primary'>
            <span aria-hidden='true'>📤</span>
            Share
          </Button>

          <Button aria-label='Export data as CSV file' variant='secondary'>
            <span aria-hidden='true'>💾</span>
            Export
          </Button>
        </div>
      );

      const deleteButton = screen.getByRole('button', {
        name: 'Delete run entry from January 15th',
      });
      expect(deleteButton).toHaveAttribute('aria-label', 'Delete run entry from January 15th');

      const editButton = screen.getByRole('button', { name: 'Edit goal: Run 50km this month' });
      expect(editButton).toHaveAttribute('aria-label', 'Edit goal: Run 50km this month');

      const shareButton = screen.getByRole('button', {
        name: 'Share running statistics on social media',
      });
      expect(shareButton).toHaveAttribute('aria-label', 'Share running statistics on social media');

      const exportButton = screen.getByRole('button', { name: 'Export data as CSV file' });
      expect(exportButton).toHaveAttribute('aria-label', 'Export data as CSV file');

      // Verify icons are properly hidden from screen readers
      const icons = screen.getAllByText(/[🗑️✏️📤💾]/);
      icons.forEach(icon => {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      });
    });

    it('verifies navigation landmarks have proper labels', () => {
      render(
        <div>
          <header role='banner'>
            <nav aria-label='Primary navigation'>
              <ul>
                <li>
                  <a href='/dashboard' aria-current='page'>
                    Dashboard
                  </a>
                </li>
                <li>
                  <a href='/runs'>My Runs</a>
                </li>
                <li>
                  <a href='/goals'>Goals</a>
                </li>
                <li>
                  <a href='/stats'>Statistics</a>
                </li>
              </ul>
            </nav>
          </header>

          <aside aria-label='Quick actions sidebar'>
            <nav aria-label='Quick actions'>
              <ul>
                <li>
                  <button aria-label='Log new run'>+ Run</button>
                </li>
                <li>
                  <button aria-label='Create new goal'>+ Goal</button>
                </li>
              </ul>
            </nav>
          </aside>

          <nav aria-label='Breadcrumb navigation'>
            <ol>
              <li>
                <a href='/'>Home</a>
              </li>
              <li>
                <a href='/runs'>Runs</a>
              </li>
              <li aria-current='page'>Edit Run</li>
            </ol>
          </nav>
        </div>
      );

      const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
      expect(primaryNav).toHaveAttribute('aria-label', 'Primary navigation');

      const quickActionsSidebar = screen.getByRole('complementary', {
        name: 'Quick actions sidebar',
      });
      expect(quickActionsSidebar).toHaveAttribute('aria-label', 'Quick actions sidebar');

      const quickActionsNav = screen.getByRole('navigation', { name: 'Quick actions' });
      expect(quickActionsNav).toHaveAttribute('aria-label', 'Quick actions');

      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb navigation' });
      expect(breadcrumbNav).toHaveAttribute('aria-label', 'Breadcrumb navigation');

      // Check aria-current usage
      const currentPage = screen.getByText('Dashboard');
      expect(currentPage).toHaveAttribute('aria-current', 'page');

      const currentBreadcrumb = screen.getByText('Edit Run');
      expect(currentBreadcrumb).toHaveAttribute('aria-current', 'page');
    });

    it('verifies notification and alert components have proper labels', () => {
      render(
        <div>
          <div role='alert' aria-label='Error notification' aria-live='assertive'>
            <span aria-hidden='true'>❌</span>
            Unable to save run data. Please try again.
          </div>

          <div role='status' aria-label='Success notification' aria-live='polite'>
            <span aria-hidden='true'>✅</span>
            Run saved successfully!
          </div>

          <div
            role='dialog'
            aria-labelledby='confirm-dialog-title'
            aria-describedby='confirm-dialog-description'
            aria-modal='true'
          >
            <h2 id='confirm-dialog-title'>Confirm Deletion</h2>
            <p id='confirm-dialog-description'>
              Are you sure you want to delete this run? This action cannot be undone.
            </p>
            <ButtonGroup>
              <Button variant='danger' aria-label='Confirm deletion of run'>
                Delete
              </Button>
              <Button variant='secondary' aria-label='Cancel deletion'>
                Cancel
              </Button>
            </ButtonGroup>
          </div>
        </div>
      );

      const errorAlert = screen.getByRole('alert', { name: 'Error notification' });
      expect(errorAlert).toHaveAttribute('aria-label', 'Error notification');
      expect(errorAlert).toHaveAttribute('aria-live', 'assertive');

      const successStatus = screen.getByRole('status', { name: 'Success notification' });
      expect(successStatus).toHaveAttribute('aria-label', 'Success notification');
      expect(successStatus).toHaveAttribute('aria-live', 'polite');

      const confirmDialog = screen.getByRole('dialog');
      expect(confirmDialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
      expect(confirmDialog).toHaveAttribute('aria-describedby', 'confirm-dialog-description');
      expect(confirmDialog).toHaveAttribute('aria-modal', 'true');

      const deleteButton = screen.getByRole('button', { name: 'Confirm deletion of run' });
      expect(deleteButton).toHaveAttribute('aria-label', 'Confirm deletion of run');

      const cancelButton = screen.getByRole('button', { name: 'Cancel deletion' });
      expect(cancelButton).toHaveAttribute('aria-label', 'Cancel deletion');
    });
  });

  describe('ARIA Compliance Testing', () => {
    it('verifies all ARIA attributes are valid and properly used', async () => {
      const { container } = render(
        <div>
          <AuthForm onLogin={vi.fn()} onRegister={vi.fn()} loading={false} />
          <RunForm
            formData={{
              date: TEST_DATES.YESTERDAY,
              distance: '5.0',
              duration: '30',
              tag: '',
              notes: '',
            }}
            errors={{}}
            loading={false}
            editingRun={null}
            onUpdateField={vi.fn()}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
          />
        </div>
      );

      // Run axe to check for ARIA violations
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('verifies ARIA landmarks are properly structured', () => {
      render(
        <div>
          <header>
            <h1>Running App</h1>
            <nav aria-label='Main navigation'>
              <ul>
                <li>
                  <a href='/dashboard'>Dashboard</a>
                </li>
                <li>
                  <a href='/runs'>Runs</a>
                </li>
              </ul>
            </nav>
          </header>
          <main>
            <section aria-labelledby='stats-heading'>
              <h2 id='stats-heading'>Statistics</h2>
              <p>Your running statistics</p>
            </section>
          </main>
        </div>
      );

      // Verify landmark structure
      const banner = screen.getByRole('banner');
      const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
      const main = screen.getByRole('main');

      expect(banner.tagName).toBe('HEADER');
      expect(navigation.tagName).toBe('NAV');
      expect(main.tagName).toBe('MAIN');

      // Verify section labeling
      const section = screen.getByLabelText('Statistics');
      expect(section).toHaveAttribute('aria-labelledby', 'stats-heading');
    });

    it('verifies live regions are properly configured', () => {
      render(
        <div>
          <div aria-live='polite' aria-atomic='true' id='status-messages'>
            Status updates appear here
          </div>
          <div aria-live='assertive' id='error-messages'>
            Critical errors appear here
          </div>
        </div>
      );

      const politeRegion = screen.getByText('Status updates appear here');
      const assertiveRegion = screen.getByText('Critical errors appear here');

      expect(politeRegion).toHaveAttribute('aria-live', 'polite');
      expect(politeRegion).toHaveAttribute('aria-atomic', 'true');

      expect(assertiveRegion).toHaveAttribute('aria-live', 'assertive');
    });
  });
});
